import Image from "next/image";
import { after } from "next/server";
import { ExternalLink, TrendingDown } from "lucide-react";
import { fetchWantlist, wantPrimaryArtist } from "@/lib/discogs";
import type { WantlistRelease } from "@/lib/discogs";
import {
  getRecentAlerts,
  getWantPrices,
  refreshWantlistIfStale,
} from "@/lib/wantlist-store";

export const dynamic = "force-dynamic";

function formatUsd(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

// Deep link to the actual copies for sale — what you'd click to buy.
function shopUrl(releaseId: number): string {
  return `https://www.discogs.com/sell/release/${releaseId}`;
}

export default async function WantlistPage() {
  const [wants, prices, alerts] = await Promise.all([
    fetchWantlist(),
    getWantPrices(),
    getRecentAlerts(30),
  ]);

  // Keep prices fresh without blocking the render — the daily cron is the
  // primary path; this covers gaps when the cron hasn't fired yet.
  after(() => refreshWantlistIfStale());

  const byId = new Map<number, WantlistRelease>(
    wants.map((w) => [w.basic_information.id, w]),
  );

  const available = wants.filter(
    (w) => prices[w.basic_information.id]?.price != null,
  );
  const cheapest =
    available.length > 0
      ? Math.min(...available.map((w) => prices[w.basic_information.id]!.price!))
      : null;

  // Cheapest-first; unavailable (or never-checked) at the end, newest wants
  // first within that group.
  const sorted = [...wants].sort((a, b) => {
    const pa = prices[a.basic_information.id]?.price ?? null;
    const pb = prices[b.basic_information.id]?.price ?? null;
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return b.date_added.localeCompare(a.date_added);
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary/80 font-medium">
          The hunt
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Wantlist
        </h1>
        <p className="text-sm text-muted-foreground">
          Your Discogs wantlist with live marketplace floors — checked daily,
          drops flagged.
        </p>
      </div>

      {wants.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card/40 p-8 text-sm text-muted-foreground text-center">
          Your Discogs wantlist is empty. Add wants on Discogs and they&apos;ll
          show up here with price tracking.
        </div>
      ) : (
        <>
          {/* Top-line tiles */}
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Wants" value={wants.length.toLocaleString()} />
            <Tile
              label="Available now"
              value={available.length.toLocaleString()}
              sub={`${wants.length - available.length} unavailable`}
            />
            <Tile
              label="Cheapest pickup"
              value={cheapest != null ? formatUsd(cheapest) : "—"}
            />
          </div>

          {/* Price drops */}
          {alerts.length > 0 && (
            <section className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-medium">
                  Last 30 days
                </div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Price drops
                </h2>
              </div>
              <ul className="space-y-2">
                {alerts.map((a, i) => {
                  const w = byId.get(a.releaseId);
                  const info = w?.basic_information;
                  return (
                    <li key={`${a.releaseId}-${i}`}>
                      <a
                        href={shopUrl(a.releaseId)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5 hover:bg-primary/10 transition-colors"
                      >
                        <TrendingDown className="w-4 h-4 text-primary shrink-0" />
                        <div className="w-11 h-11 shrink-0 relative rounded overflow-hidden bg-muted ring-1 ring-white/5">
                          {info?.thumb && (
                            <Image
                              src={info.thumb}
                              alt={info.title}
                              fill
                              sizes="44px"
                              className="object-cover"
                              unoptimized
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {info?.title ?? `Release ${a.releaseId}`}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {w ? wantPrimaryArtist(w) : ""}
                            {" · "}
                            {a.oldPrice == null
                              ? "back in stock"
                              : `was ${formatUsd(a.oldPrice)}`}
                            {" · "}
                            {formatDate(a.date)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums text-primary shrink-0">
                          {formatUsd(a.newPrice)}
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Full wantlist */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              All wants
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                cheapest first
              </span>
            </h2>
            <ul className="space-y-2">
              {sorted.map((w) => {
                const info = w.basic_information;
                const p = prices[info.id];
                return (
                  <li key={w.id}>
                    <a
                      href={shopUrl(info.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2.5 hover:bg-card/70 transition-colors group"
                    >
                      <div className="w-12 h-12 shrink-0 relative rounded overflow-hidden bg-muted ring-1 ring-white/5">
                        {info.thumb && (
                          <Image
                            src={info.thumb}
                            alt={info.title}
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                          {info.title}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {wantPrimaryArtist(w)}
                          {info.year > 0 ? ` · ${info.year}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {p?.price != null ? (
                          <>
                            <div className="text-sm font-semibold tabular-nums">
                              {formatUsd(p.price)}
                            </div>
                            {p.numForSale != null && (
                              <div className="text-[11px] text-muted-foreground tabular-nums">
                                {p.numForSale} for sale
                              </div>
                            )}
                          </>
                        ) : p ? (
                          <div className="text-xs text-muted-foreground">
                            none for sale
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground/60">
                            checking…
                          </div>
                        )}
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="font-semibold text-xl mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
