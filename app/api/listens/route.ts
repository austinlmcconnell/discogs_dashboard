import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { listens } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(listens).orderBy(desc(listens.listenedAt)).limit(200);
  return NextResponse.json({ listens: rows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { releaseId?: number; notes?: string };
  if (!body.releaseId) {
    return NextResponse.json({ error: "releaseId required" }, { status: 400 });
  }
  const [row] = await db
    .insert(listens)
    .values({ releaseId: body.releaseId, notes: body.notes })
    .returning();
  return NextResponse.json({ listen: row });
}
