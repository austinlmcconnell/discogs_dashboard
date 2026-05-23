import { NextResponse } from "next/server";
import { fetchFullCollection } from "@/lib/discogs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const releases = await fetchFullCollection();
    if (releases.length === 0) {
      return NextResponse.json({ error: "Collection is empty" }, { status: 404 });
    }
    const pick = releases[Math.floor(Math.random() * releases.length)];
    return NextResponse.json({ release: pick });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
