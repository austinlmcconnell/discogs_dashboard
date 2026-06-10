"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Disc3, Music2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VinylDisc } from "@/components/vinyl-sleeve";
import { logListenWithRating } from "@/lib/log-listen";
import type { Vinyl } from "@/lib/vinyl-color";

// Full-screen "Now Spinning" mode: big always-spinning vinyl, side-grouped
// tracklist (tap a track to mark what's playing), elapsed clock, and a
// one-tap finish that logs the listen + rating.

export type SpinningTrack = {
  position: string;
  title: string;
  duration: string;
};

type Props = {
  releaseId: number;
  title: string;
  artist: string;
  cover: string;
  vinyl: Vinyl;
  photoUrl: string | null;
  tracklist: SpinningTrack[];
  initialRating: number | null;
};

// Group "A1/A2/B1…" positions into sides; non-lettered tracklists collapse
// into a single unnamed group. Pure — safe to derive during render.
function groupBySide(
  tracks: SpinningTrack[],
): { side: string | null; tracks: SpinningTrack[] }[] {
  const groups: { side: string | null; tracks: SpinningTrack[] }[] = [];
  for (const t of tracks) {
    const m = /^([A-Za-z])\d/.exec(t.position.trim());
    const side = m ? m[1].toUpperCase() : null;
    const last = groups[groups.length - 1];
    if (last && last.side === side) last.tracks.push(t);
    else groups.push({ side, tracks: [t] });
  }
  return groups;
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function NowSpinning(props: Props) {
  // startMs doubles as the open flag: null = closed. Set from the click
  // handler (Date.now() is fine in event handlers, not render).
  const [startMs, setStartMs] = useState<number | null>(null);

  return (
    <>
      <Button onClick={() => setStartMs(Date.now())} className="gap-2">
        <Disc3 className="w-4 h-4" />
        Now Spinning
      </Button>
      {startMs != null ? (
        <SpinningOverlay
          {...props}
          startMs={startMs}
          onClose={() => setStartMs(null)}
        />
      ) : null}
    </>
  );
}

function SpinningOverlay({
  releaseId,
  title,
  artist,
  cover,
  vinyl,
  photoUrl,
  tracklist,
  initialRating,
  startMs,
  onClose,
}: Props & { startMs: number; onClose: () => void }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [currentPos, setCurrentPos] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  // Tick the elapsed clock and lock body scroll while the overlay is up;
  // Escape closes. All synchronization with external systems (timer, DOM,
  // window) — state updates only happen inside async callbacks.
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(interval);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [startMs, onClose]);

  function finish() {
    startTransition(async () => {
      try {
        await logListenWithRating(releaseId, { notes, rating });
        toast.success(
          rating != null && rating !== initialRating
            ? `Listen logged · rated ${rating}/10`
            : "Listen logged",
        );
        onClose();
        router.refresh();
      } catch {
        toast.error("Couldn't log listen");
      }
    });
  }

  const sides = groupBySide(tracklist);
  const display = hover ?? rating ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40">
        <div className="min-w-0 flex-1">
          <div className="font-semibold tracking-tight truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">{artist}</div>
        </div>
        <div className="text-sm tabular-nums text-primary font-medium">
          {formatElapsed(elapsed)}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without logging"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-2 gap-6 px-6 py-6 overflow-y-auto">
        {/* The record, always spinning */}
        <div className="flex items-center justify-center">
          <div className="w-[min(70vmin,560px)] aspect-square [animation:vinyl-spin_10s_linear_infinite] motion-reduce:[animation:none]">
            <VinylDisc vinyl={vinyl} cover={cover} photoUrl={photoUrl} />
          </div>
        </div>

        {/* Tracklist by side */}
        <div className="lg:overflow-y-auto lg:max-h-full space-y-5 lg:pr-2">
          {sides.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.side ? (
                <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-medium">
                  Side {group.side}
                </div>
              ) : null}
              <ol className="rounded-lg border border-border/50 bg-card/30 divide-y divide-border/30">
                {group.tracks.map((t, i) => {
                  const isCurrent = currentPos === `${gi}-${i}`;
                  return (
                    <li key={`${t.position}-${i}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentPos(isCurrent ? null : `${gi}-${i}`)
                        }
                        className={`w-full grid grid-cols-[2.5rem_1fr_auto] gap-3 px-4 py-2 text-sm items-center text-left transition-colors ${
                          isCurrent
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {isCurrent ? (
                            <Music2 className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            t.position || "—"
                          )}
                        </span>
                        <span className="truncate">{t.title}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t.duration}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: rate + finish */}
      <div className="border-t border-border/40 px-5 py-3 flex flex-wrap items-center gap-3">
        <div
          className="flex items-center"
          onMouseLeave={() => setHover(null)}
          role="group"
          aria-label="Rate this album"
        >
          {Array.from({ length: 10 }).map((_, i) => {
            const value = i + 1;
            const filled = value <= display;
            return (
              <button
                key={value}
                type="button"
                onMouseEnter={() => setHover(value)}
                onClick={() => setRating(rating === value ? null : value)}
                className="p-0.5 -mx-px focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 rounded"
                aria-label={`${value} out of 10`}
                disabled={pending}
              >
                <Star
                  className={`w-4 h-4 ${
                    filled
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground"
                  }`}
                />
              </button>
            );
          })}
          <span className="ml-2 text-xs tabular-nums text-muted-foreground">
            {rating ?? "—"}/10
          </span>
        </div>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)…"
          className="flex-1 min-w-[160px] h-9 rounded-md border border-border/60 bg-card/40 px-3 text-sm focus:outline-none focus:border-primary/60"
        />
        <Button onClick={finish} disabled={pending} className="gap-2">
          <Disc3 className="w-4 h-4" />
          Finish &amp; log listen
        </Button>
      </div>
    </div>
  );
}
