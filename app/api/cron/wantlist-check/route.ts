import { NextResponse } from "next/server";
import { refreshWantlist } from "@/lib/wantlist-store";

// Daily wantlist price check, triggered by Vercel Cron (see vercel.ts).
// Also callable manually to seed the first price baseline.
//
// Same CRON_SECRET convention as the value-snapshot cron: enforced when the
// env var is set, open otherwise (an extra manual refresh is harmless).
export const dynamic = "force-dynamic";
// Throttled sweep over the wantlist — allow the full timeout budget.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await refreshWantlist();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/wantlist-check] failed:", err);
    return NextResponse.json({ error: "refresh_failed" }, { status: 500 });
  }
}
