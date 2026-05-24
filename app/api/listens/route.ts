import { NextResponse } from "next/server";
import { addListen, listAllListens } from "@/lib/listens-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listAllListens(200);
  return NextResponse.json({ listens: rows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { releaseId?: number; notes?: string };
  if (!body.releaseId) {
    return NextResponse.json(
      { error: "releaseId required" },
      { status: 400 },
    );
  }
  const listen = await addListen(body.releaseId, body.notes);
  return NextResponse.json({ listen });
}
