import { NextResponse } from "next/server";
import {
  deleteRating,
  getRating,
  setRating,
} from "@/lib/ratings-store";

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
  const row = await getRating(id);
  return NextResponse.json({ rating: row });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  const body = (await req.json()) as { rating?: number; notes?: string };
  if (
    body.rating === undefined ||
    body.rating < 0 ||
    body.rating > 10
  ) {
    return NextResponse.json(
      { error: "rating must be 0-10" },
      { status: 400 },
    );
  }
  const row = await setRating(id, body.rating, body.notes);
  return NextResponse.json({ rating: row });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid releaseId" }, { status: 400 });
  }
  await deleteRating(id);
  return NextResponse.json({ ok: true });
}
