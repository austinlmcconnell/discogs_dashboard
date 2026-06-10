import Link from "next/link";
import Image from "next/image";
import { fetchFullCollection, primaryArtist } from "@/lib/discogs";
import type { CollectionRelease } from "@/lib/discogs";
import { listAllListens } from "@/lib/listens-store";
import { listAllRatings } from "@/lib/ratings-store";
import {
  comfortPool,
  daysSince,
  dustyPool,
  pickSurprise,
  pickUniform,
  type SpinCandidate,
} from "@/lib/spin";
import { SpinModes } from "@/components/spin-modes";

export const dynamic = "force-dynamic";

export default async function SpinPage() {
  const [releases, listens, ratings] = await Promise.all([
    fetchFullCollection(),
    listAllListens(100000),
    listAllRatings(),
  ]);

  if (releases.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-semibold">No records found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your Discogs collection appears to be empty.
        </p>
      </div>
    );
  }

  const byId = new Map<number, CollectionRelease>(
    releases.map((r) => [r.basic_information.id, r]),
  );

  // Most recent listen per release → days since.
  const lastListen = new Map<number, number>(); // releaseId → epoch ms
  for (const l of listens) {
    const iso = l.listenedAt.endsWith("Z") ? l.listenedAt : `${l.listenedAt}Z`;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    const prev = lastListen.get(l.releaseId);
    if (prev == null || t > prev) lastListen.set(l.releaseId, t);
  }
  const ratingMap = new Map<number, number>(
    ratings.map((r) => [r.releaseId, r.rating]),
  );

  const candidates: SpinCandidate[] = releases.map((r) => {
    const id = r.basic_information.id;
    return {
      id,
      daysSince: daysSince(lastListen.get(id)),
      rating: ratingMap.get(id) ?? null,
    };
  });

  // Tonight's queue: one pick per mode, no duplicates. Server-picked, so it
  // reshuffles on every visit to the page.
  const picked = new Set<number>();
  const queue: { candidate: SpinCandidate; mode: string }[] = [];
  const surprise = pickSurprise(candidates, picked);
  if (surprise) {
    picked.add(surprise.id);
    queue.push({ candidate: surprise, mode: "Surprise" });
  }
  const dusty = pickUniform(dustyPool(candidates), picked);
  if (dusty) {
    picked.add(dusty.id);
    queue.push({ candidate: dusty, mode: "Dusty corner" });
  }
  const comfort = pickUniform(comfortPool(candidates).pool, picked);
  if (comfort) {
    picked.add(comfort.id);
    queue.push({ candidate: comfort, mode: "Comfort" });
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary/80 font-medium">
          Smart Spin
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          What&apos;s spinning tonight?
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a mode — or grab something straight from the queue. Filters on
          the collection page narrow the regular spin too.
        </p>
      </div>

      <SpinModes candidates={candidates} />

      {queue.length > 0 && (
        <section className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-medium">
              Fresh picks, every visit
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              Tonight&apos;s queue
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {queue.map(({ candidate, mode }) => {
              const r = byId.get(candidate.id);
              const info = r?.basic_information;
              return (
                <Link
                  key={candidate.id}
                  href={`/album/${candidate.id}?from=spin`}
                  className="group rounded-lg border border-border/60 bg-card/40 overflow-hidden hover:border-primary/40 hover:bg-card/70 transition-all hover:-translate-y-0.5"
                >
                  <div className="aspect-square relative bg-muted">
                    {info?.cover_image || info?.thumb ? (
                      <Image
                        src={info.cover_image || info.thumb}
                        alt={info.title}
                        fill
                        sizes="(max-width: 640px) 100vw, 280px"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        unoptimized
                      />
                    ) : null}
                    <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-background/80 backdrop-blur px-2 py-0.5 rounded-full border border-border/60">
                      {mode}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {info?.title ?? `Release ${candidate.id}`}
                    </div>
                    {r && (
                      <div className="text-xs text-muted-foreground truncate">
                        {primaryArtist(r)}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground/70 mt-1">
                      {candidate.daysSince == null
                        ? "Never played"
                        : candidate.daysSince === 0
                          ? "Played today"
                          : `Last played ${candidate.daysSince}d ago`}
                      {candidate.rating != null &&
                        ` · rated ${candidate.rating}/10`}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
