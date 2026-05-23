"use client";

import { useEffect, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  releaseId: number;
  initialRating: number | null;
};

export function RatingInput({ releaseId, initialRating }: Props) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRating(initialRating);
  }, [initialRating]);

  const display = hover ?? rating ?? 0;

  async function save(next: number | null) {
    setRating(next);
    startTransition(async () => {
      try {
        if (next === null) {
          await fetch(`/api/ratings/${releaseId}`, { method: "DELETE" });
          toast.success("Rating cleared");
        } else {
          await fetch(`/api/ratings/${releaseId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating: next }),
          });
          toast.success(`Rated ${next}/10`);
        }
      } catch {
        toast.error("Couldn't save rating");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
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
              onClick={() => save(rating === value ? null : value)}
              className="p-0.5 -mx-px focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 rounded"
              aria-label={`${value} out of 10`}
              disabled={pending}
            >
              <Star
                className={`w-4 h-4 ${filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
              />
            </button>
          );
        })}
      </div>
      <div className="text-sm tabular-nums w-10 text-muted-foreground">
        {rating ?? "—"}
        <span className="text-xs">/10</span>
      </div>
      {rating !== null && (
        <Button variant="ghost" size="sm" onClick={() => save(null)} disabled={pending}>
          Clear
        </Button>
      )}
    </div>
  );
}
