import { sql } from "drizzle-orm";
import type { Redis } from "@upstash/redis";
import { fetchFullCollection, fetchMarketplaceStats } from "@/lib/discogs";
import { db } from "@/lib/db";
import { releasePrices } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

// Median-price map for the whole collection. Shared by the collection-grid
// sort (via /api/collection-prices) and the value tracker (snapshots).
// Two-tier cache:
//   1. Upstash Redis (via Vercel Marketplace integration). Persists across
//      Vercel cold starts. Keyed `price:<release_id>` with a 24h TTL;
//      bulk-read via mget.
//   2. Local SQLite (release_prices table). Fallback when Redis env vars
//      aren't present (typical local dev). Persists across dev restarts.
//
// Either way, the build path is: read cache → identify missing release IDs
// → throttled fetch from /marketplace/stats for the missing → write back.
//
// DATA SOURCE & LABELING NOTE:
// The user-facing label is "Median price" because that's what matches the
// Discogs.com release page UI (Discogs's Sales-History "Median" stat).
// Discogs doesn't expose that median via the public API; lowest_price
// (marketplace floor) tracks within ~$5-10 because sellers calibrate
// listings to recent sales.

const TTL_HOURS = 24;
const TTL_SECONDS = TTL_HOURS * 60 * 60;
// Discogs allows 60 authenticated req/min; 850ms ≈ 70/min nominally, with
// discogsFetch's 429 retry-with-backoff handling any spillover.
const THROTTLE_MS = 850;

export type PriceMap = Record<number, number | null>;
type PriceEntry = { price: number | null; currency: string | null };

// Dedupe overlapping build requests. While the slow first build runs, any
// other caller awaits the same Promise.
let inflight: Promise<PriceMap> | null = null;

// Exported for reuse by the wantlist price checker — same Discogs rate
// budget applies to both sweeps.
export async function throttledRun<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  intervalMs: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  for (let i = 0; i < items.length; i++) {
    try {
      results[i] = await fn(items[i]);
    } catch {
      results[i] = null as unknown as R;
    }
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return results;
}

async function buildWithRedis(redis: Redis): Promise<PriceMap> {
  const releases = await fetchFullCollection();
  const ids = releases.map((release) => release.basic_information.id);

  // Bulk-read every release's cached entry in one round-trip. @upstash/redis
  // auto-parses JSON values, so cached entries come back as PriceEntry | null.
  const keys = ids.map((id) => `price:${id}`);
  const cached =
    keys.length > 0 ? await redis.mget<(PriceEntry | null)[]>(...keys) : [];

  const map = new Map<number, number | null>();
  const missing: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const entry = cached[i];
    if (entry == null) missing.push(ids[i]);
    else map.set(ids[i], entry.price);
  }

  if (missing.length > 0) {
    const stats = await throttledRun(
      missing,
      (id) => fetchMarketplaceStats(id),
      THROTTLE_MS,
    );
    const pipeline = redis.pipeline();
    for (let i = 0; i < missing.length; i++) {
      const s = stats[i];
      const entry: PriceEntry = {
        price: s?.lowest_price?.value ?? null,
        currency: s?.lowest_price?.currency ?? null,
      };
      pipeline.set(`price:${missing[i]}`, entry, { ex: TTL_SECONDS });
      map.set(missing[i], entry.price);
    }
    await pipeline.exec();
  }

  const prices: PriceMap = {};
  for (const id of ids) prices[id] = map.get(id) ?? null;
  return prices;
}

async function buildWithSqlite(): Promise<PriceMap> {
  const releases = await fetchFullCollection();
  const ids = releases.map((r) => r.basic_information.id);

  const cutoffIso = new Date(
    Date.now() - TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const existing = db
    .select()
    .from(releasePrices)
    .where(sql`fetched_at > ${cutoffIso}`)
    .all();
  const fresh = new Map<number, number | null>();
  for (const row of existing) fresh.set(row.releaseId, row.price);

  const missing = ids.filter((id) => !fresh.has(id));

  if (missing.length > 0) {
    const stats = await throttledRun(
      missing,
      (id) => fetchMarketplaceStats(id),
      THROTTLE_MS,
    );
    for (let i = 0; i < missing.length; i++) {
      const s = stats[i];
      const price = s?.lowest_price?.value ?? null;
      const currency = s?.lowest_price?.currency ?? null;
      db.insert(releasePrices)
        .values({ releaseId: missing[i], price, currency })
        .onConflictDoUpdate({
          target: releasePrices.releaseId,
          set: { price, currency, fetchedAt: sql`CURRENT_TIMESTAMP` },
        })
        .run();
      fresh.set(missing[i], price);
    }
  }

  const prices: PriceMap = {};
  for (const id of ids) prices[id] = fresh.get(id) ?? null;
  return prices;
}

// Build (or read from cache) the full collection price map. Slow only when
// many releases have aged out of the 24h price cache; otherwise one Redis
// mget / SQLite select.
export async function buildPriceMap(): Promise<PriceMap> {
  if (!inflight) {
    inflight = (async () => {
      const redis = getRedis();
      return redis ? buildWithRedis(redis) : buildWithSqlite();
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
