import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { Redis } from "@upstash/redis";
import { fetchFullCollection, fetchMarketplaceStats } from "@/lib/discogs";
import { db } from "@/lib/db";
import { releasePrices } from "@/lib/db/schema";

// Median-price map for the collection grid's sort. Two-tier cache:
//   1. Upstash Redis (via Vercel Marketplace integration). Persists across
//      Vercel cold starts so first-load latency is ~50ms regardless of how
//      long the function instance has been idle. Keyed `price:<release_id>`
//      with a 24h TTL; bulk-read via mget.
//   2. Local SQLite (release_prices table). Fallback when Redis env vars
//      aren't present (typical local dev with no Vercel CLI link). Persists
//      across dev server restarts.
//
// Either way, the build path is: read cache → identify missing release IDs
// → throttled fetch from /marketplace/stats for the missing → write back.
//
// DATA SOURCE & LABELING NOTE:
// The user-facing label is "Median price" because that's what matches the
// Discogs.com release page UI (Discogs's Sales-History "Median" stat).
// Discogs doesn't expose that median via the public API; lowest_price
// (marketplace floor) tracks within ~$5-10 because sellers calibrate
// listings to recent sales. See the album page for the same trade-off.
export const dynamic = "force-dynamic";

const TTL_HOURS = 24;
const TTL_SECONDS = TTL_HOURS * 60 * 60;
// Discogs allows 60 authenticated req/min; 850ms ≈ 70/min nominally, with
// discogsFetch's 429 retry-with-backoff handling any spillover.
const THROTTLE_MS = 850;

type PriceMap = Record<number, number | null>;
type PriceEntry = { price: number | null; currency: string | null };

// Lazy-init Redis singleton. Returns null when env vars aren't set so we
// don't crash on local dev / first deploy before the Marketplace
// integration is connected. Both the canonical UPSTASH_* names and the
// legacy KV_* names are checked for compatibility with older provisioning.
let _redis: Redis | null = null;
let _redisInitialized = false;
function getRedis(): Redis | null {
  if (_redisInitialized) return _redis;
  _redisInitialized = true;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Dedupe overlapping requests during the slow first-load build. While the
// initial fetch runs, any other GET sees the same Promise.
let inflight: Promise<PriceMap> | null = null;

async function throttledRun<T, R>(
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

async function buildPriceMap(): Promise<PriceMap> {
  const redis = getRedis();
  return redis ? buildWithRedis(redis) : buildWithSqlite();
}

export async function GET() {
  try {
    if (!inflight) {
      inflight = buildPriceMap().finally(() => {
        inflight = null;
      });
    }
    const prices = await inflight;
    return NextResponse.json(
      { prices },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
