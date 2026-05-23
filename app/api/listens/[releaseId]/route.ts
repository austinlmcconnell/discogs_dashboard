import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listens } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const rows = await db
    .select()
    .from(listens)
    .where(eq(listens.releaseId, id))
    .orderBy(desc(listens.listenedAt));
  return NextResponse.json({ listens: rows });
}
