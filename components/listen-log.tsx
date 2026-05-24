"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Headphones, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Listen } from "@/lib/listens-store";

function formatDate(iso: string) {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  // Date only (no time). EST/EDT timezone so the date matches the user's
  // calendar regardless of the underlying UTC timestamp.
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export function ListenLog({
  releaseId,
  initialListens,
  initialRating,
}: {
  releaseId: number;
  initialListens: Listen[];
  initialRating: number | null;
}) {
  const [listens, setListens] = useState(initialListens);
  const [notes, setNotes] = useState("");
  // Local rating state for the "rate while logging" flow. Defaults to the
  // album's existing rating so a user who just wants to log a listen and not
  // re-rate sees the current value and can submit unchanged. A new value here
  // becomes the album's rating after submit (router.refresh keeps the parent
  // page's RatingInput in sync).
  const [rating, setRating] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const display = hover ?? rating ?? 0;

  function logListen() {
    startTransition(async () => {
      try {
        const listenPromise = fetch(`/api/listens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releaseId, notes: notes || undefined }),
        });
        // Fire the rating update in parallel when a rating is set. If the
        // user left rating null we skip the PUT entirely so we don't create
        // a zero/blank rating row.
        const ratingPromise =
          rating !== null
            ? fetch(`/api/ratings/${releaseId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rating }),
              })
            : Promise.resolve(null);

        const [listenRes, ratingRes] = await Promise.all([
          listenPromise,
          ratingPromise,
        ]);
        if (!listenRes.ok) throw new Error("listen failed");
        if (ratingRes && !ratingRes.ok) throw new Error("rating failed");

        const { listen } = (await listenRes.json()) as { listen: Listen };
        setListens((prev) => [listen, ...prev]);
        setNotes("");
        toast.success(
          rating !== null && rating !== initialRating
            ? `Listen logged · rated ${rating}/10`
            : "Listen logged",
        );
        // Pull a fresh server render so the RatingInput on the page shows the
        // updated rating (and the home-page rating sort, etc.).
        router.refresh();
      } catch {
        toast.error("Couldn't log listen");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div
          className="flex items-center gap-2"
          onMouseLeave={() => setHover(null)}
          role="group"
          aria-label="Rating for this listen"
        >
          <div className="flex items-center">
            {Array.from({ length: 10 }).map((_, i) => {
              const value = i + 1;
              const filled = value <= display;
              return (
                <button
                  key={value}
                  type="button"
                  onMouseEnter={() => setHover(value)}
                  onClick={() =>
                    setRating(rating === value ? null : value)
                  }
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
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {rating ?? "—"}/10
          </div>
        </div>
        <Textarea
          placeholder="Notes for this listen (optional)…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <Button onClick={logListen} disabled={pending} className="gap-2">
          <Headphones className="w-4 h-4" />
          Log a listen
        </Button>
      </div>
      {listens.length > 0 && (
        <ul className="space-y-2 text-sm">
          {listens.map((l) => (
            <li key={l.id} className="border rounded-md px-3 py-2">
              <div className="text-xs text-muted-foreground">
                {formatDate(l.listenedAt)}
              </div>
              {l.notes && (
                <div className="mt-1 whitespace-pre-wrap">{l.notes}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
