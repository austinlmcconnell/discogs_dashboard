import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { fetchFullCollection, fetchMarketplaceStats } from "@/lib/discogs";
import { db } from "@/lib/db";
import { releasePrices } from "@/lib/db/schema";

// Lazy-loaded by the collection grid when the user picks the median-price
// sort. Now backed by a SQLite cache table (release_prices) so we only hit
// Discogs for records we don't already have a fresh value for. Locally this
// means: slow on first ever load (one Discogs call per release), instant for
// every subsequent load until rows age out. On Vercel: persists across warm
// starts, wiped on cold starts (until /tmp is replaced with a managed DB).
//
// DATA SOURCE & LABELING NOTE:
// The user-facing label is "Median price" because that's what matches the
// Discogs.com release page UI (Discogs's Sales-History "Median" stat). But
// Discogs does NOT expose that median via the public API — only:
//   - /marketplace/price_suggestions  → algorithmic seller-suggestion by
//                                       condition, often DRAMATICALLY higher
//                                       than the on-page median (e.g.,
//                                       Hunky Dory VG+ = $382 vs Discogs's
//                                       displayed median $45).
//   - /marketplace/stats.lowest_price → cheapest copy currently for sale.
//                                       Consistently close to the on-page
//                                       median (within ~$5-10) because
//                                       sellers calibrate listings to
//                                       recent sales.
// We use lowest_price as the best available proxy for the on-page median.
// If Discogs ever ships a sales-history API, we'd swap this out.
export const dynamic = "force-dynamic";

const TTL_HOURS = 24;
// Throttle between Discogs calls — Discogs allows 60 authenticated req/min.
// 850ms ≈ 70/min nominally; with the 429 retry in discogsFetch handling
// any spillover, we run comfortably close to the limit instead of crawling
// at 55/min like before.
const THROTTLE_MS = 850;

type PriceMap = Record<number, number | null>;

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

async function buildPriceMap(): Promise<PriceMap> {
  const releases = await fetchFullCollection();
  const ids = releases.map((r) => r.basic_information.id);

  // Read the rows we already have that are still fresh.
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

  // Anything not in the fresh set needs to be fetched.
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
