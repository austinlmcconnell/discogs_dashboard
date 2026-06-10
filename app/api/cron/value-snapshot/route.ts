import { NextResponse } from "next/server";
import { takeSnapshot } from "@/lib/value-store";

// Weekly collection-value snapshot, triggered by Vercel Cron (see crons
// config). Also callable manually to seed the first data point.
//
// When a CRON_SECRET env var is set on the project, Vercel includes
// `Authorization: Bearer <CRON_SECRET>` on cron invocations and we reject
// anything without it. When unset (hobby setup), the route is open — worst
// case someone triggers an extra snapshot, which is idempotent per day.
export const dynamic = "force-dynamic";
// Cold-cache snapshot does the throttled Discogs price sweep — allow the
// full timeout budget rather than the shorter default.
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
    const snapshot = await takeSnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    console.error("[cron/value-snapshot] failed:", err);
    return NextResponse.json({ error: "snapshot_failed" }, { status: 500 });
  }
}
