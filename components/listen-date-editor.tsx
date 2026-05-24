"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

// Render a listen's date as a small clickable label. Click → reveal a native
// date picker. Pick a date → PATCH /api/listens/[releaseId] → re-render with
// the new value. Optimistic: the label updates instantly; if the request
// fails, we revert and toast.

// Format a stored ISO timestamp as a "Mon DD, YYYY" date in EST.
function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

// Convert an ISO timestamp to "YYYY-MM-DD" in EST (what <input type="date">
// expects as its value). Done via toLocaleDateString with en-CA which
// produces ISO-style YYYY-MM-DD output reliably regardless of locale.
function isoToDateInputValue(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function ListenDateEditor({
  releaseId,
  listenId,
  listenedAt,
}: {
  releaseId: number;
  listenId: number;
  listenedAt: string;
}) {
  const [iso, setIso] = useState(listenedAt);
  const [pending, startTransition] = useTransition();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value; // "YYYY-MM-DD"
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    const previous = iso;
    // Optimistic: store noon UTC for the picked date so the displayed value
    // matches what the server will compute.
    const optimistic = new Date(`${newDate}T12:00:00.000Z`).toISOString();
    setIso(optimistic);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/listens/${releaseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: listenId, date: newDate }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Listen date updated");
      } catch {
        setIso(previous);
        toast.error("Couldn't update date");
      }
    });
  }

  return (
    <label
      className={`inline-flex items-center cursor-pointer relative ${
        pending ? "opacity-60" : ""
      }`}
      title="Click to change date"
    >
      <span className="text-[11px] text-muted-foreground/80 uppercase tracking-wider tabular-nums hover:text-foreground transition-colors">
        {formatDate(iso)}
      </span>
      <input
        type="date"
        value={isoToDateInputValue(iso)}
        onChange={onPick}
        disabled={pending}
        // The native picker is the entire interaction surface — visually
        // hidden, but covers the label so clicking the label triggers it.
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
    </label>
  );
}
