import { NextResponse } from "next/server";
import { listListens } from "@/lib/listens-store";

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
