"use client";

import { useState, useTransition } from "react";
import { Headphones } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Listen } from "@/lib/db/schema";

function formatDate(iso: string) {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ListenLog({
  releaseId,
  initialListens,
}: {
  releaseId: number;
  initialListens: Listen[];
}) {
  const [listens, setListens] = useState(initialListens);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function logListen() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/listens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releaseId, notes: notes || undefined }),
        });
        if (!res.ok) throw new Error();
        const { listen } = (await res.json()) as { listen: Listen };
        setListens((prev) => [listen, ...prev]);
        setNotes("");
        toast.success("Listen logged");
      } catch {
        toast.error("Couldn't log listen");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
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
              <div className="text-xs text-muted-foreground">{formatDate(l.listenedAt)}</div>
              {l.notes && <div className="mt-1 whitespace-pre-wrap">{l.notes}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
