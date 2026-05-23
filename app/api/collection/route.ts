import { NextResponse } from "next/server";
import { fetchFullCollection } from "@/lib/discogs";

export const revalidate = 3600;

export async function GET() {
  try {
    const releases = await fetchFullCollection();
    return NextResponse.json({ count: releases.length, releases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
