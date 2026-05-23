"use client";

import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
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
  | "price-asc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "date-added-desc", label: "Recently added" },
  { key: "date-added-asc", label: "Oldest added" },
  { key: "artist-asc", label: "Artist (A–Z)" },
  { key: "artist-desc", label: "Artist (Z–A)" },
  { key: "title-asc", label: "Title (A–Z)" },
  { key: "title-desc", label: "Title (Z–A)" },
  { key: "year-desc", label: "Year (newest)" },
  { key: "year-asc", label: "Year (oldest)" },
  { key: "price-desc", label: "Lowest for sale (high → low)" },
  { key: "price-asc", label: "Lowest for sale (low → high)" },
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

export function CollectionGrid({ releases }: { releases: CollectionRelease[] }) {
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
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState(false);
  const pricesFetchedRef = useRef(false);
  const deferredQuery = useDeferredValue(query);

  // Lazy-fetch the median price map. Triggered from the sort dropdown's
  // onChange handler (NOT from a useEffect) so we avoid the cascading-render
  // anti-pattern flagged by react-hooks/set-state-in-effect.
  const ensurePricesLoaded = useCallback(() => {
    if (pricesFetchedRef.current) return;
    pricesFetchedRef.current = true;
    setPricesLoading(true);
    setPricesError(false);
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
        // Allow a retry on next selection if it failed.
        pricesFetchedRef.current = false;
      })
      .finally(() => {
        setPricesLoading(false);
      });
  }, []);

  function handleSortChange(next: SortKey) {
    setSortKey(next);
    if (PRICE_SORTS.has(next)) ensurePricesLoaded();
  }

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
            onChange={(e) => handleSortChange(e.target.value as SortKey)}
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
          {isPriceSort && pricesLoading && (
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
