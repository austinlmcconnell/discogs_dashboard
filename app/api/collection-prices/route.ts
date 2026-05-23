import { NextResponse } from "next/server";
import { fetchFullCollection, fetchMarketplaceStats } from "@/lib/discogs";

// Lazy-loaded by the collection grid when the user picks a price sort.
// Each underlying Discogs fetch is cached by Next.js (revalidate=3600), so
// only the first call after cache expiry actually hits Discogs.
//
// Uses marketplace lowest-price (cheapest copy currently for sale) — this
// matches what Discogs surfaces as "Lowest" on the release page. The
// alternative, /marketplace/price_suggestions, returns Discogs's algorithmic
// SUGGESTED SELLER PRICE BY CONDITION which routinely runs higher than the
// actual marketplace floor for older catalog records (Can't Buy a Thrill,
// Steely Dan reissues, etc.) and was confusing to read.
export const dynamic = "force-dynamic";

// Throttled sequential runner. Discogs allows 60 authenticated requests per
// minute; we sleep ~1.1s between calls (≈55/min) to stay safely under that.
// Subsequent calls are served by Next.js's fetch cache (revalidate=86400)
// and don't actually hit Discogs.
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

// Module-level cache for the aggregated map. The first GET populates this
// (slow, takes ~1 minute per 60 records); subsequent GETs return immediately.
// 24-hour TTL so prices stay fresh enough without re-running the slow loop.
//
// DEPLOY-TIME NOTE: on Vercel, a cold-cache first-run for a large collection
// (>250 records × 1.1s throttle) can brush the 300s function timeout. If/when
// this becomes a problem, the right fix is to move the buildPriceMap loop to
// Vercel Workflow (durable execution, pause/resume, retries) and have this
// route just read the resulting persisted map. Locally and on the cached
// path, it's fine.
type PriceMap = Record<number, number | null>;
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
// Bump SOURCE_VERSION whenever the meaning of the price changes (data source,
// pick logic, currency handling). Old cache entries with a different version
// are discarded so the user doesn't see stale values keyed to a defunct
// definition. Current source: marketplace lowest-price.
const SOURCE_VERSION = 2;
let cached: { prices: PriceMap; at: number; version: number } | null = null;
let inflight: Promise<PriceMap> | null = null;

async function buildPriceMap(): Promise<PriceMap> {
  const releases = await fetchFullCollection();
  const ids = releases.map((r) => r.basic_information.id);
  const stats = await throttledRun(
    ids,
    (id) => fetchMarketplaceStats(id),
    1100,
  );
  const prices: PriceMap = {};
  for (let i = 0; i < ids.length; i++) {
    // null = no copies currently for sale on Discogs. Sorted to the end.
    prices[ids[i]] = stats[i]?.lowest_price?.value ?? null;
  }
  return prices;
}

export async function GET() {
  try {
    if (
      cached &&
      cached.version === SOURCE_VERSION &&
      Date.now() - cached.at < PRICE_TTL_MS
    ) {
      return NextResponse.json(
        { prices: cached.prices, cached: true },
        { headers: { "Cache-Control": "private, max-age=300" } },
      );
    }
    // Dedupe overlapping requests during the slow first load.
    if (!inflight) {
      inflight = buildPriceMap().finally(() => {
        // Always release inflight so a failure doesn't block future retries.
        inflight = null;
      });
    }
    const prices = await inflight;
    cached = { prices, at: Date.now(), version: SOURCE_VERSION };
    return NextResponse.json(
      { prices },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
