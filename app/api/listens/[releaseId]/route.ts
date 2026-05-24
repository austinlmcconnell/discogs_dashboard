import { NextResponse } from "next/server";
import { listListens, updateListenDate } from "@/lib/listens-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const rows = await listListens(id);
  return NextResponse.json({ listens: rows });
}

// PATCH: update the listenedAt date of a specific listen. Body: { id, date }
// where `date` is a "YYYY-MM-DD" string (HTML <input type="date"> output).
// We store noon UTC for that date so the rendered date stays stable across
// the EST/EDT boundary regardless of DST.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = await ctx.params;
  const rid = Number(releaseId);
  if (!Number.isFinite(rid)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const body = (await req.json()) as { id?: number; date?: string };
  if (!body.id || !body.date) {
    return NextResponse.json(
      { error: "id and date required" },
      { status: 400 },
    );
  }
  // Validate YYYY-MM-DD format strictly so we don't get JS Date timezone
  // surprises from looser parses ("May 24" etc.).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  const isoAtNoonUtc = new Date(`${body.date}T12:00:00.000Z`).toISOString();
  const updated = await updateListenDate(rid, body.id, isoAtNoonUtc);
  if (!updated) {
    return NextResponse.json({ error: "listen not found" }, { status: 404 });
  }
  return NextResponse.json({ listen: updated });
}
