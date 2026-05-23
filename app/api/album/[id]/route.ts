import { NextResponse } from "next/server";
import { fetchMarketplaceStats, fetchPriceSuggestions, fetchRelease } from "@/lib/discogs";
import { fetchAlbumWiki } from "@/lib/wikipedia";

export const revalidate = 3600;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const releaseId = Number(id);
  if (!Number.isFinite(releaseId)) {
    return NextResponse.json({ error: "Invalid release id" }, { status: 400 });
  }

  try {
    const release = await fetchRelease(releaseId);
    const artist = release.artists.map((a) => a.name).join(", ");
    const [priceSuggestions, marketplace, wiki] = await Promise.all([
      fetchPriceSuggestions(releaseId),
      fetchMarketplaceStats(releaseId),
      fetchAlbumWiki(artist, release.title, release.year),
    ]);

    return NextResponse.json({ release, priceSuggestions, marketplace, wiki });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
