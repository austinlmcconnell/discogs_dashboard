const SEARCH = "https://en.wikipedia.org/w/api.php";
const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";

export type WikiSummary = {
  title: string;
  extract: string;
  description?: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls?: { desktop?: { page: string } };
};

async function searchTitle(query: string): Promise<string | null> {
  const url = new URL(SEARCH);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    query?: { search?: { title: string }[] };
  };
  return data.query?.search?.[0]?.title ?? null;
}

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const res = await fetch(`${SUMMARY}/${encodeURIComponent(title)}`, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) return null;
  return (await res.json()) as WikiSummary;
}

export async function fetchAlbumWiki(
  artist: string,
  album: string,
  year?: number,
): Promise<WikiSummary | null> {
  // Try most specific query first.
  const queries = [
    `${album} ${artist} album${year ? ` ${year}` : ""}`,
    `${album} ${artist} album`,
    `${album} (${artist} album)`,
    `${album} album`,
  ];
  for (const q of queries) {
    const title = await searchTitle(q);
    if (!title) continue;
    const summary = await fetchSummary(title);
    if (summary?.extract && summary.extract.length > 80) return summary;
  }
  return null;
}
