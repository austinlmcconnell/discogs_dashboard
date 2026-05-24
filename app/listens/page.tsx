import Link from "next/link";
import Image from "next/image";
import { fetchFullCollection, primaryArtist } from "@/lib/discogs";
import { listAllListens } from "@/lib/listens-store";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  // Explicit component options (NOT dateStyle/timeStyle) — the Intl spec
  // throws "Invalid option : option" if you combine dateStyle/timeStyle with
  // timeZoneName. America/New_York handles EST/EDT switching automatically.
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export default async function ListensPage() {
  const [rows, releases] = await Promise.all([
    listAllListens(200),
    fetchFullCollection(),
  ]);

  const byId = new Map(releases.map((r) => [r.basic_information.id, r]));

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary/80 font-medium">
          History
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Recent listens</h1>
        <p className="text-sm text-muted-foreground">
          Everything you&apos;ve logged, most recent first.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card/40 p-8 text-sm text-muted-foreground text-center">
          No listens yet. Pick a record and log one.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((l) => {
            const r = byId.get(l.releaseId);
            const info = r?.basic_information;
            return (
              <li
                key={l.id}
                className="flex gap-4 rounded-lg border border-border/60 bg-card/40 p-3 items-start hover:bg-card/70 transition-colors"
              >
                <Link
                  href={`/album/${l.releaseId}`}
                  className="w-16 h-16 shrink-0 relative rounded-md overflow-hidden bg-muted ring-1 ring-white/5"
                >
                  {info?.thumb && (
                    <Image
                      src={info.thumb}
                      alt={info.title}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized
                    />
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/album/${l.releaseId}`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {info?.title ?? `Release ${l.releaseId}`}
                  </Link>
                  {r && (
                    <div className="text-xs text-muted-foreground">{primaryArtist(r)}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground/80 mt-1 uppercase tracking-wider tabular-nums">
                    {formatDate(l.listenedAt)}
                  </div>
                  {l.notes && (
                    <div className="text-sm mt-2 whitespace-pre-wrap text-foreground/85">
                      {l.notes}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
