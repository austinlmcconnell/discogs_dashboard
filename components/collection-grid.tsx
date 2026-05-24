"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Stash the grid's scroll position in sessionStorage so navigating into an
// album page and back (via browser back, router.back(), or the "Collection"
// button) lands the user where they left off. App Router's built-in scroll
// restoration is unreliable for our setup (mix of dynamic page + client grid),
// so we manage it manually.
const SCROLL_KEY = "collection-scroll";
import { ChevronDown, Filter, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AlbumCard } from "@/components/album-card";
import { RandomizeButton } from "@/components/randomize-button";
import type { CollectionRelease } from "@/lib/discogs";
import { primaryArtist } from "@/lib/discogs";
import { detectVinyl } from "@/lib/vinyl-color";

type SortKey =
  | "date-added-desc"
  | "date-added-asc"
  | "artist-asc"
  | "artist-desc"
  | "title-asc"
  | "title-desc"
  | "year-desc"
  | "year-asc"
  | "price-desc"
  | "price-asc"
  | "rating-desc"
  | "rating-asc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "date-added-desc", label: "Recently added" },
  { key: "date-added-asc", label: "Oldest added" },
  { key: "artist-asc", label: "Artist (A–Z)" },
  { key: "artist-desc", label: "Artist (Z–A)" },
  { key: "title-asc", label: "Title (A–Z)" },
  { key: "title-desc", label: "Title (Z–A)" },
  { key: "year-desc", label: "Year (newest)" },
  { key: "year-asc", label: "Year (oldest)" },
  { key: "rating-desc", label: "My rating (high → low)" },
  { key: "rating-asc", label: "My rating (low → high)" },
  { key: "price-desc", label: "Median price (high → low)" },
  { key: "price-asc", label: "Median price (low → high)" },
];

const COLOR_FILTERS = ["Colored", "Black"] as const;
type ColorFilter = (typeof COLOR_FILTERS)[number];

function decadeOf(year: number): string | null {
  if (!year || year < 1900) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

// Classify a collection release as colored vinyl vs black. Uses the same
// detectVinyl logic the album page uses — anything Discogs hints at via
// format descriptions (Pink, Splatter, Marbled, Translucent Blue, etc.)
// counts as colored; the default (no color found) is treated as black.
function isColoredVinyl(release: CollectionRelease): boolean {
  // Read BOTH descriptions and text — same pattern the album page uses, since
  // Discogs typically buries the actual color descriptor in `text` (e.g.
  // "Pink Translucent") while `descriptions` only carries categorical tags.
  // Reading only descriptions previously meant ~every record matched "Black",
  // hence the filter only finding Parklife (an outlier where the color
  // happened to be in descriptions).
  const descs: string[] = [];
  for (const f of release.basic_information.formats ?? []) {
    if (f.descriptions) descs.push(...f.descriptions);
    if (f.text) descs.push(f.text);
  }
  if (descs.length === 0) return false;
  const v = detectVinyl(descs);
  return !(v.variant === "solid" && v.primary === "#0a0a0a");
}

const PRICE_SORTS: ReadonlySet<SortKey> = new Set(["price-desc", "price-asc"]);

export function CollectionGrid({
  releases,
  ratingMap = {},
}: {
  releases: CollectionRelease[];
  ratingMap?: Record<number, number>;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date-added-desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [selectedDecades, setSelectedDecades] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [selectedColors, setSelectedColors] = useState<ReadonlySet<ColorFilter>>(
    () => new Set<ColorFilter>(),
  );
  const [pricesMap, setPricesMap] = useState<Record<
    number,
    number | null
  > | null>(null);
  const [pricesError, setPricesError] = useState(false);
  const pricesFetchedRef = useRef(false);
  const deferredQuery = useDeferredValue(query);

  // Pre-fetch the median-price map as soon as the page mounts — don't wait
  // for the user to pick a price sort. The backend caches in SQLite, so
  // after the first build the response is near-instant. Doing this on mount
  // means the user usually never sees a loading indicator at all; if they
  // do, it's started running while they were browsing.
  //
  // No synchronous setState happens in this effect body — only inside the
  // async fetch callback — so react-hooks/set-state-in-effect doesn't flag.
  useEffect(() => {
    if (pricesFetchedRef.current) return;
    pricesFetchedRef.current = true;
    fetch("/api/collection-prices")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          prices: Record<number, number | null>;
        };
        setPricesMap(data.prices);
      })
      .catch(() => {
        setPricesError(true);
        // Allow a retry the next time the component re-mounts.
        pricesFetchedRef.current = false;
      });
  }, []);

  // Scroll restoration: restore on mount if we have a saved position, then
  // continuously save the current scrollY (debounced) so any time the user
  // navigates away the latest position is captured. Passive listener per
  // client-passive-event-listeners best practice.
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      const y = parseInt(saved, 10);
      if (Number.isFinite(y)) window.scrollTo(0, y);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      }, 100);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Build the available filter values from the actual collection, sorted by
  // frequency so the most common options surface first.
  const { allGenres, allDecades } = useMemo(() => {
    const genres = new Map<string, number>();
    const decades = new Map<string, number>();
    for (const r of releases) {
      const info = r.basic_information;
      for (const g of info.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + 1);
      const dec = decadeOf(info.year);
      if (dec) decades.set(dec, (decades.get(dec) ?? 0) + 1);
    }
    return {
      allGenres: [...genres.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k),
      allDecades: [...decades.keys()].sort(),
    };
  }, [releases]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let result = releases;
    if (q) {
      result = result.filter((r) => {
        const info = r.basic_information;
        const hay =
          `${info.title} ${primaryArtist(r)} ${info.year} ${(info.genres ?? []).join(" ")} ${(info.styles ?? []).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (selectedGenres.size) {
      result = result.filter((r) =>
        (r.basic_information.genres ?? []).some((g) => selectedGenres.has(g)),
      );
    }
    if (selectedDecades.size) {
      result = result.filter((r) => {
        const d = decadeOf(r.basic_information.year);
        return d ? selectedDecades.has(d) : false;
      });
    }
    if (selectedColors.size) {
      result = result.filter((r) => {
        const colored = isColoredVinyl(r);
        if (colored && selectedColors.has("Colored")) return true;
        if (!colored && selectedColors.has("Black")) return true;
        return false;
      });
    }

    const sorted = [...result];
    switch (sortKey) {
      case "date-added-desc":
        sorted.sort((a, b) => b.date_added.localeCompare(a.date_added));
        break;
      case "date-added-asc":
        sorted.sort((a, b) => a.date_added.localeCompare(b.date_added));
        break;
      case "artist-asc":
        sorted.sort((a, b) =>
          primaryArtist(a).localeCompare(primaryArtist(b), undefined, {
            sensitivity: "base",
          }),
        );
        break;
      case "artist-desc":
        sorted.sort((a, b) =>
          primaryArtist(b).localeCompare(primaryArtist(a), undefined, {
            sensitivity: "base",
          }),
        );
        break;
      case "title-asc":
        sorted.sort((a, b) =>
          a.basic_information.title.localeCompare(
            b.basic_information.title,
            undefined,
            { sensitivity: "base" },
          ),
        );
        break;
      case "title-desc":
        sorted.sort((a, b) =>
          b.basic_information.title.localeCompare(
            a.basic_information.title,
            undefined,
            { sensitivity: "base" },
          ),
        );
        break;
      case "year-desc":
        sorted.sort(
          (a, b) =>
            (b.basic_information.year || 0) - (a.basic_information.year || 0),
        );
        break;
      case "year-asc":
        sorted.sort(
          (a, b) =>
            (a.basic_information.year || 0) - (b.basic_information.year || 0),
        );
        break;
      case "price-desc":
        // Missing/unknown prices go to the END regardless of direction.
        sorted.sort((a, b) => {
          const pa = pricesMap?.[a.basic_information.id];
          const pb = pricesMap?.[b.basic_information.id];
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return pb - pa;
        });
        break;
      case "price-asc":
        sorted.sort((a, b) => {
          const pa = pricesMap?.[a.basic_information.id];
          const pb = pricesMap?.[b.basic_information.id];
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return pa - pb;
        });
        break;
      case "rating-desc":
        // Unrated records sort to the END — same convention as price.
        sorted.sort((a, b) => {
          const ra = ratingMap[a.basic_information.id];
          const rb = ratingMap[b.basic_information.id];
          if (ra == null && rb == null) return 0;
          if (ra == null) return 1;
          if (rb == null) return -1;
          return rb - ra;
        });
        break;
      case "rating-asc":
        sorted.sort((a, b) => {
          const ra = ratingMap[a.basic_information.id];
          const rb = ratingMap[b.basic_information.id];
          if (ra == null && rb == null) return 0;
          if (ra == null) return 1;
          if (rb == null) return -1;
          return ra - rb;
        });
        break;
    }
    return sorted;
  }, [
    releases,
    deferredQuery,
    sortKey,
    selectedGenres,
    selectedDecades,
    selectedColors,
    pricesMap,
    ratingMap,
  ]);

  function toggleString(
    set: ReadonlySet<string>,
    setter: (s: ReadonlySet<string>) => void,
    value: string,
  ) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  function toggleColor(value: ColorFilter) {
    const next = new Set(selectedColors);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSelectedColors(next);
  }

  function clearAllFilters() {
    setSelectedGenres(new Set());
    setSelectedDecades(new Set());
    setSelectedColors(new Set());
  }

  const totalActiveFilters =
    selectedGenres.size + selectedDecades.size + selectedColors.size;
  const isPriceSort = PRICE_SORTS.has(sortKey);

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 max-w-md min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search title, artist, year, genre…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-card/40 border-border/60 h-10"
          />
        </div>

        {/* Filters toggle */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-md border text-sm transition-colors ${
            filtersOpen || totalActiveFilters > 0
              ? "bg-primary/10 border-primary/40 text-primary"
              : "bg-card/40 border-border/60 text-foreground/80 hover:text-foreground hover:border-border"
          }`}
          aria-expanded={filtersOpen}
          aria-controls="collection-filter-panel"
        >
          <Filter className="w-4 h-4" />
          Filters
          {totalActiveFilters > 0 && (
            <span className="text-[10px] tabular-nums leading-none px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
              {totalActiveFilters}
            </span>
          )}
        </button>

        {/* Sort */}
        <div className="relative h-10 inline-flex items-center">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="appearance-none h-10 pl-3 pr-9 rounded-md border border-border/60 bg-card/40 text-sm text-foreground/90 hover:border-border focus:outline-none focus:border-primary/60 cursor-pointer"
            aria-label="Sort by"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          {isPriceSort && !pricesMap && !pricesError && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading prices…
            </span>
          )}
          {isPriceSort && pricesError && (
            <span className="ml-2 text-xs text-red-500">
              Couldn’t load prices
            </span>
          )}
        </div>

        <RandomizeButton releases={filtered} />

        <div className="text-xs text-muted-foreground ml-auto tabular-nums uppercase tracking-wider">
          {filtered.length} of {releases.length}
        </div>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div
          id="collection-filter-panel"
          className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4"
        >
          <FilterRow
            label="Genre"
            values={allGenres}
            selected={selectedGenres}
            onToggle={(v) =>
              toggleString(selectedGenres, setSelectedGenres, v)
            }
          />
          <FilterRow
            label="Decade"
            values={allDecades}
            selected={selectedDecades}
            onToggle={(v) =>
              toggleString(selectedDecades, setSelectedDecades, v)
            }
          />
          <FilterRow
            label="Color"
            values={[...COLOR_FILTERS]}
            selected={selectedColors as ReadonlySet<string>}
            onToggle={(v) => toggleColor(v as ColorFilter)}
          />
          {totalActiveFilters > 0 && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-7">
        {filtered.map((release) => (
          <AlbumCard key={release.instance_id} release={release} />
        ))}
      </div>
    </div>
  );
}

function FilterRow({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string;
  values: string[];
  selected: ReadonlySet<string>;
  onToggle: (v: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const isActive = selected.has(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent border-border/60 text-foreground/80 hover:border-border hover:text-foreground"
              }`}
              aria-pressed={isActive}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
