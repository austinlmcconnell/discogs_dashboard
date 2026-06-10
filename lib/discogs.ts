const API_BASE = "https://api.discogs.com";

function token() {
  const t = process.env.DISCOGS_TOKEN;
  if (!t) throw new Error("DISCOGS_TOKEN is not set");
  return t;
}

function username() {
  const u = process.env.DISCOGS_USERNAME;
  if (!u) throw new Error("DISCOGS_USERNAME is not set");
  return u;
}

function userAgent() {
  return process.env.DISCOGS_USER_AGENT ?? "DiscogsDashboard/0.1";
}

type FetchOpts = { revalidate?: number };

async function discogsFetch<T>(
  path: string,
  opts: FetchOpts = {},
  attempt = 0,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Discogs token=${token()}`,
      "User-Agent": userAgent(),
    },
    next: { revalidate: opts.revalidate ?? 3600 },
  });
  // Honor Discogs rate-limiting (60 req/min auth). When the price-pool burst
  // saturates the bucket, user-facing clicks would otherwise 404; retry with
  // backoff so the click eventually succeeds.
  if (res.status === 429 && attempt < 3) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 2;
    const waitMs = Math.max(1000, retryAfterSec * 1000) * (attempt + 1);
    await new Promise((r) => setTimeout(r, waitMs));
    return discogsFetch<T>(path, opts, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discogs ${res.status} for ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export type CollectionRelease = {
  instance_id: number;
  id: number; // release id
  rating: number;
  date_added: string;
  folder_id: number;
  basic_information: {
    id: number;
    master_id: number;
    title: string;
    year: number;
    cover_image: string;
    thumb: string;
    resource_url: string;
    formats: {
      name: string;
      qty: string;
      descriptions?: string[];
      // Discogs puts specific color/variant descriptors here ("Pink Translucent",
      // "Black / White / Yellow Smoke", "Sulphuric Yellow"). `descriptions` only
      // captures broader category tags ("LP", "Album", "Limited Edition"), so
      // color detection on the collection page MUST also read `text`.
      text?: string;
    }[];
    labels: { name: string; catno: string; id: number }[];
    artists: { name: string; id: number; anv?: string; join?: string }[];
    genres: string[];
    styles: string[];
  };
};

type CollectionPage = {
  pagination: { page: number; pages: number; per_page: number; items: number; urls: { next?: string } };
  releases: CollectionRelease[];
};

// A wantlist entry. basic_information matches the collection shape closely;
// we type only the fields we use.
export type WantlistRelease = {
  id: number; // release id
  rating: number;
  notes?: string;
  date_added: string;
  basic_information: {
    id: number;
    master_id: number;
    title: string;
    year: number;
    cover_image: string;
    thumb: string;
    formats: { name: string; qty: string; descriptions?: string[]; text?: string }[];
    labels: { name: string; catno: string; id: number }[];
    artists: { name: string; id: number; anv?: string; join?: string }[];
    genres?: string[];
    styles?: string[];
  };
};

type WantlistPage = {
  pagination: { urls: { next?: string } };
  wants: WantlistRelease[];
};

export async function fetchWantlist(): Promise<WantlistRelease[]> {
  const user = username();
  const all: WantlistRelease[] = [];
  let url: string | undefined =
    `${API_BASE}/users/${encodeURIComponent(user)}/wants?per_page=100`;
  while (url) {
    const page: WantlistPage = await discogsFetch<WantlistPage>(url);
    all.push(...page.wants);
    url = page.pagination.urls.next;
  }
  return all;
}

export function wantPrimaryArtist(want: WantlistRelease): string {
  return want.basic_information.artists
    .map((a) => `${a.anv || a.name}${a.join ? ` ${a.join} ` : ""}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchFullCollection(): Promise<CollectionRelease[]> {
  const user = username();
  const all: CollectionRelease[] = [];
  let url: string | undefined =
    `${API_BASE}/users/${encodeURIComponent(user)}/collection/folders/0/releases?per_page=100&sort=added&sort_order=desc`;
  while (url) {
    const page: CollectionPage = await discogsFetch<CollectionPage>(url);
    all.push(...page.releases);
    url = page.pagination.urls.next;
  }
  return all;
}

export type ReleaseDetail = {
  id: number;
  title: string;
  year: number;
  country?: string;
  released?: string;
  notes?: string;
  artists: { name: string; id: number }[];
  labels: { name: string; catno: string }[];
  formats: { name: string; qty: string; descriptions?: string[]; text?: string }[];
  genres?: string[];
  styles?: string[];
  tracklist: {
    position: string;
    type_: string;
    title: string;
    duration: string;
    extraartists?: { name: string; role: string }[];
  }[];
  images?: { type: string; uri: string; uri150: string; width: number; height: number }[];
  community?: {
    rating: { count: number; average: number };
    have: number;
    want: number;
  };
  estimated_weight?: number;
  lowest_price?: number;
  num_for_sale?: number;
  master_id?: number;
  master_url?: string;
  uri?: string;
};

export async function fetchRelease(releaseId: number): Promise<ReleaseDetail> {
  return discogsFetch<ReleaseDetail>(`/releases/${releaseId}`);
}

export type PriceSuggestions = Record<
  string,
  { currency: string; value: number }
>;

export async function fetchPriceSuggestions(releaseId: number): Promise<PriceSuggestions | null> {
  try {
    return await discogsFetch<PriceSuggestions>(`/marketplace/price_suggestions/${releaseId}`);
  } catch {
    return null;
  }
}

export type MarketplaceStats = {
  lowest_price?: { currency: string; value: number } | null;
  num_for_sale?: number;
  blocked_from_sale?: boolean;
};

export async function fetchMarketplaceStats(releaseId: number): Promise<MarketplaceStats | null> {
  try {
    return await discogsFetch<MarketplaceStats>(`/marketplace/stats/${releaseId}`);
  } catch {
    return null;
  }
}

export function primaryArtist(release: CollectionRelease): string {
  return release.basic_information.artists
    .map((a) => `${a.anv || a.name}${a.join ? ` ${a.join} ` : ""}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
