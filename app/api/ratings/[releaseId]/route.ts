import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ratings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const row = await db.select().from(ratings).where(eq(ratings.releaseId, id)).get();
  return NextResponse.json({ rating: row ?? null });
}

export async function PUT(req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const body = (await req.json()) as { rating?: number; notes?: string };
  if (body.rating === undefined || body.rating < 0 || body.rating > 10) {
    return NextResponse.json({ error: "rating must be 0-10" }, { status: 400 });
  }
  const [row] = await db
    .insert(ratings)
    .values({ releaseId: id, rating: body.rating, notes: body.notes })
    .onConflictDoUpdate({
      target: ratings.releaseId,
      set: { rating: body.rating, notes: body.notes, updatedAt: new Date().toISOString() },
    })
    .returning();
  return NextResponse.json({ rating: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  await db.delete(ratings).where(eq(ratings.releaseId, id));
  return NextResponse.json({ ok: true });
}
