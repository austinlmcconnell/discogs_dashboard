import { NextResponse } from "next/server";
import { buildPriceMap } from "@/lib/prices";

// Median-price map for the collection grid's sort. All the cache/build
// logic lives in lib/prices.ts (shared with the value-snapshot tracker).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prices = await buildPriceMap();
    return NextResponse.json(
      { prices },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
