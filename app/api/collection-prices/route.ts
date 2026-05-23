import { NextResponse } from "next/server";
import { fetchFullCollection, fetchPriceSuggestions } from "@/lib/discogs";

// Lazy-loaded by the collection grid when the user picks a price sort.
// Each underlying Discogs fetch is cached by Next.js (revalidate=3600), so
// only the first call after cache expiry actually hits Discogs.
//
// Uses /marketplace/price_suggestions and picks the VG+ price (with NM/first
// fallback) to match what the album page surfaces as "Median (VG+)". The
// home page sort and the album page stat now agree — selecting "Median price
// (high → low)" puts the same record at the top that shows the highest
// "Median (VG+)" when you click into it.
//
// Note: this is Discogs's algorithmic suggested seller price by condition,
// derived from sales history. It typically runs HIGHER than the actual
// marketplace floor (the cheapest copy currently for sale). That's expected
// — the median reflects what records have sold for, not the current listing
// floor. If you want "cheapest available right now," that's a different
// metric (marketplace lowest_price).
export const dynamic = "force-dynamic";

// Conditions to prefer when picking a single representative "median" price
// per release, matching the album page's pick order.
const CONDITION_PREFERENCE = [
  "Very Good Plus (VG+)",
  "Near Mint (NM or M-)",
  "Very Good (VG)",
  "Good Plus (G+)",
  "Good (G)",
];

function pickPrice(
  suggestions: Record<string, { value: number; currency: string }> | null,
): number | null {
  if (!suggestions) return null;
  for (const cond of CONDITION_PREFERENCE) {
    if (suggestions[cond]) return suggestions[cond].value;
  }
  const first = Object.values(suggestions)[0];
  return first?.value ?? null;
}

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
// definition. Current source: price_suggestions VG+ (album-page "Median").
const SOURCE_VERSION = 3;
let cached: { prices: PriceMap; at: number; version: number } | null = null;
let inflight: Promise<PriceMap> | null = null;

async function buildPriceMap(): Promise<PriceMap> {
  const releases = await fetchFullCollection();
  const ids = releases.map((r) => r.basic_information.id);
  const suggestions = await throttledRun(
    ids,
    (id) => fetchPriceSuggestions(id),
    1100,
  );
  const prices: PriceMap = {};
  for (let i = 0; i < ids.length; i++) {
    // null = no price suggestion available (e.g., user's Discogs seller
    // settings disabled, or no sales history for this release). Sorted to
    // the end so meaningful values bubble to the top.
    prices[ids[i]] = pickPrice(suggestions[i]);
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
