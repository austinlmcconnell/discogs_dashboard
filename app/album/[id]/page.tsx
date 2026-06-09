import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CollectionBackLink } from "@/components/collection-back-link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { ListenLog } from "@/components/listen-log";
import { VinylSleeve } from "@/components/vinyl-sleeve";
import { listListens } from "@/lib/listens-store";
import { getRating } from "@/lib/ratings-store";
import {
  fetchMarketplaceStats,
  fetchPriceSuggestions,
  fetchRelease,
} from "@/lib/discogs";
import { fetchAlbumWiki } from "@/lib/wikipedia";
import {
  detectVinyl,
  expectedVinylColors,
  parseVinylFromText,
  ringCheckColors,
} from "@/lib/vinyl-color";
import { findVinylShot, sampleOverrideShade, sampleVinylShade } from "@/lib/vinyl-image";
import { getVinylOverride } from "@/lib/vinyl-overrides";
import { ImageGallery } from "@/components/image-gallery";

export const revalidate = 3600;

function formatCurrency(value: number | undefined | null, currency = "USD") {
  if (value == null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const releaseId = Number(id);
  if (!Number.isFinite(releaseId)) notFound();

  let release;
  try {
    release = await fetchRelease(releaseId);
  } catch {
    notFound();
  }

  const artist = release.artists.map((a) => a.name).join(", ");

  const [priceSuggestions, marketplace, wiki, userListens, userRating] =
    await Promise.all([
      fetchPriceSuggestions(releaseId),
      fetchMarketplaceStats(releaseId),
      fetchAlbumWiki(artist, release.title, release.year),
      listListens(releaseId),
      getRating(releaseId),
    ]);

  const cover = release.images?.[0]?.uri ?? "";
  const secondaryImages = (release.images ?? []).filter((img) => img.type !== "primary");

  // Scan ONLY the format-level color fields: descriptions array + the format
  // text field (Discogs puts "Red Translucent", "Black / White / Yellow Smoke",
  // etc. in `text`). Never include the title, release notes, or anything else
  // — those often mention colors innocuously ("The Red Album", song titles).
  const colorDescriptors =
    release.formats?.flatMap((f) => [
      ...(f.descriptions ?? []),
      f.text,
    ]).filter((s): s is string => Boolean(s)) ?? [];
  const explicit = expectedVinylColors(colorDescriptors);
  const ringColors = ringCheckColors(explicit);

  // Hand-picked override from the Google Sheet (lib/vinyl-overrides.ts) wins
  // over detection. Three paths:
  //   - kind "photo" → photoUrl points at the API route, which fetches & crops
  //     the override image directly. No findVinylShot run.
  //   - kind "svg"   → no photo; sample the vinyl color from the override
  //     image's outer ring and apply it to the SVG fallback.
  //   - no override  → run normal detection + (if none found) cross-image
  //     shade sampling.
  const override = await getVinylOverride(releaseId);

  const vinylPhoto =
    override?.kind === "photo"
      ? true
      : override?.kind === "svg"
        ? false
        : Boolean(
            await findVinylShot(
              secondaryImages.map((img) => img.uri),
              ringColors,
              explicit,
            ),
          );

  const vinyl = detectVinyl(colorDescriptors);

  if (override?.kind === "svg") {
    // Parse the note for variant + primary + secondary color and apply all
    // three. "Dark brown with faint yellow swirl" → marbled brown/yellow.
    // "Use pink to create custom SVG version" → solid pink (variant
    // unchanged, inherits whatever detectVinyl returned from Discogs).
    // "Outer clear color" → clear variant, no color change.
    // If the note doesn't name anything we can use, fall back to sampling
    // the dominant color from the override image.
    let noteApplied = false;
    if (override.note) {
      const parsed = parseVinylFromText(override.note);
      if (parsed.variant) {
        vinyl.variant = parsed.variant;
        noteApplied = true;
      }
      if (parsed.primary) {
        vinyl.primary = parsed.primary;
        noteApplied = true;
      }
      if (parsed.secondary) {
        vinyl.secondary = parsed.secondary;
        noteApplied = true;
      }
    }
    if (!noteApplied) {
      const shade = await sampleOverrideShade(override.imageUrl, explicit);
      if (shade) {
        vinyl.primary = `#${[shade.r, shade.g, shade.b]
          .map((c) => c.toString(16).padStart(2, "0"))
          .join("")}`;
      }
    }
  } else if (!override && !vinylPhoto && explicit && explicit.length > 0) {
    // When Discogs names a color but we couldn't find a clean vinyl photo,
    // sample the actual vinyl shade from any matching-hue pixels across all
    // images (label close-ups still show the vinyl color at their edges).
    // This makes the SVG fallback render the *real* shade instead of the
    // color-map default — sage instead of bright green, deep blue instead of
    // bright blue, etc.
    const allImageUrls = (release.images ?? []).map((img) => img.uri);
    const shade = await sampleVinylShade(allImageUrls, explicit);
    if (shade) {
      vinyl.primary = `#${[shade.r, shade.g, shade.b]
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`;
    }
  }
  const formatSummary = release.formats
    ?.map((f) =>
      [f.qty, f.name, ...(f.descriptions ?? []), f.text].filter(Boolean).join(" "),
    )
    .join(" · ");

  const lowestPrice =
    marketplace?.lowest_price?.value ?? release.lowest_price ?? null;
  const lowestCurrency = marketplace?.lowest_price?.currency ?? "USD";
  const numForSale = marketplace?.num_for_sale ?? release.num_for_sale ?? null;
  // priceSuggestions is still used below in the "Price by condition" section
  // for reference, but the headline price stat uses lowestPrice (above)
  // because price_suggestions runs algorithmically high on older records.

  return (
    <div>
      <div className="border-b border-border/30 relative isolate">
        <div className="max-w-6xl mx-auto px-6 pt-6 relative z-10">
          <CollectionBackLink />
        </div>

        <div className="max-w-6xl mx-auto px-6 py-10 lg:py-16 grid lg:grid-cols-[minmax(0,480px)_1fr] gap-10 lg:gap-12 items-center relative z-10">
          <div className="mx-auto w-full max-w-[420px] lg:max-w-none lg:w-full">
            {cover && (
              <VinylSleeve
                cover={cover}
                alt={`${artist} — ${release.title}`}
                vinyl={vinyl}
                photoUrl={vinylPhoto ? `/api/vinyl-photo/${releaseId}?v=18` : null}
              />
            )}
          </div>

          <div className="space-y-5">
            <div className="text-xs uppercase tracking-[0.2em] text-primary/80 font-medium">
              {vinyl.label}
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
                {release.title}
              </h1>
              <div className="text-xl md:text-2xl text-muted-foreground">{artist}</div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {release.year > 0 && <Badge variant="secondary">{release.year}</Badge>}
              {release.country && <Badge variant="outline">{release.country}</Badge>}
              {release.labels?.[0] && (
                <Badge variant="outline">
                  {release.labels[0].name}
                  {release.labels[0].catno ? ` · ${release.labels[0].catno}` : ""}
                </Badge>
              )}
              {(release.genres ?? []).slice(0, 3).map((g) => (
                <Badge key={g} variant="outline">{g}</Badge>
              ))}
            </div>

            {formatSummary && (
              <div className="text-sm text-muted-foreground">{formatSummary}</div>
            )}

            <Separator className="bg-border/40" />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat
                label="Community"
                value={release.community?.rating.average?.toFixed(2) ?? "—"}
                sub={`${release.community?.rating.count ?? 0} ratings`}
              />
              <Stat
                label="Have"
                value={release.community?.have?.toLocaleString() ?? "—"}
              />
              <Stat
                label="Want"
                value={release.community?.want?.toLocaleString() ?? "—"}
              />
              <Stat
                // "Median" here means the marketplace floor — the same number
                // Discogs surfaces on the release page as "Median". The
                // price_suggestions endpoint returns an algorithmic seller
                // suggestion that runs wildly high for older catalog records
                // ($382 vs $45 for Hunky Dory), so it's NOT used here even
                // though the "Price by condition" section below still
                // displays the full per-condition breakdown for reference.
                label="Median"
                value={
                  formatCurrency(lowestPrice ?? undefined, lowestCurrency) ??
                  "—"
                }
                sub={
                  numForSale != null ? `${numForSale} for sale` : undefined
                }
              />
            </div>

            {release.uri && (
              <div className="pt-2">
                <a
                  href={release.uri}
                  target="_blank"
                  rel="noreferrer"
                  className={`${buttonVariants({ variant: "outline", size: "sm" })} gap-1.5`}
                >
                  View on Discogs <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[1.5fr_1fr] gap-10 lg:gap-14">
        <div className="space-y-10 min-w-0">
          <Section title="Tracklist">
            <ol className="rounded-lg border border-border/60 bg-card/40 backdrop-blur divide-y divide-border/40">
              {release.tracklist.map((t, i) => (
                <li
                  key={`${t.position}-${i}`}
                  className="grid grid-cols-[3rem_1fr_auto] gap-3 px-4 py-2.5 text-sm items-center hover:bg-muted/30 transition-colors"
                >
                  <span className="text-muted-foreground tabular-nums text-xs">
                    {t.position || "—"}
                  </span>
                  <span className="truncate">{t.title}</span>
                  <span className="text-muted-foreground tabular-nums text-xs">
                    {t.duration}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          {(release.images?.length ?? 0) > 1 && (
            <Section title="Photos" eyebrow="From Discogs">
              <ImageGallery
                images={(release.images ?? []).map((img) => ({
                  uri: img.uri,
                  uri150: img.uri150,
                }))}
              />
            </Section>
          )}

          {wiki && (
            <Section title="From Wikipedia" eyebrow="Background">
              <div className="rounded-lg border border-border/60 bg-card/40 p-5">
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  {wiki.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={wiki.thumbnail.source}
                      alt={wiki.title}
                      className="rounded-md w-24 h-24 object-cover shrink-0"
                    />
                  )}
                  <div className="space-y-1.5 min-w-0">
                    <div className="font-medium">{wiki.title}</div>
                    {wiki.description && (
                      <div className="text-xs text-muted-foreground">{wiki.description}</div>
                    )}
                    <p className="text-sm leading-relaxed text-foreground/85">{wiki.extract}</p>
                    {wiki.content_urls?.desktop?.page && (
                      <a
                        href={wiki.content_urls.desktop.page}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline text-muted-foreground hover:text-foreground"
                      >
                        Read on Wikipedia <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {release.notes && (
            <Section title="Release notes">
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {release.notes}
              </p>
            </Section>
          )}
        </div>

        <aside className="space-y-8">
          <Section title="Listens & rating">
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <ListenLog
                releaseId={releaseId}
                initialListens={userListens}
                initialRating={userRating?.rating ?? null}
              />
            </div>
          </Section>

          {priceSuggestions && (
            <Section title="Price by condition" eyebrow="Discogs marketplace">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(priceSuggestions).map(([condition, p]) => (
                  <Stat
                    key={condition}
                    label={condition}
                    value={formatCurrency(p.value, p.currency) ?? "—"}
                  />
                ))}
              </div>
            </Section>
          )}

          {!priceSuggestions && lowestPrice != null && (
            <Section title="Marketplace">
              <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lowest</span>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(lowestPrice, lowestCurrency)}
                  </span>
                </div>
                {numForSale != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">For sale</span>
                    <span className="tabular-nums">{numForSale}</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-1">
                  Tip: enable Discogs seller settings to unlock median price by condition.
                </div>
              </div>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="font-medium text-base mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-medium">
            {eyebrow}
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}
