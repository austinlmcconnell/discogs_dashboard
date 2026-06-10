import { Suspense } from "react";
import Link from "next/link";
import { fetchFullCollection } from "@/lib/discogs";
import { CollectionGrid } from "@/components/collection-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { listAllRatings } from "@/lib/ratings-store";
import { getLatestSnapshot } from "@/lib/value-store";

// The home page reads the user's ratings on every request so the rating
// sort reflects changes immediately. The expensive Discogs collection fetch
// (fetchFullCollection) is still cached at the fetch level for an hour via
// discogsFetch's revalidate option, so making this page dynamic only costs
// a Redis read (~50ms) per request.
export const dynamic = "force-dynamic";

async function Collection() {
  // Pull the user's ratings alongside the Discogs collection so the grid
  // can offer a "Sort by my rating" option. ratings-store routes through
  // Upstash Redis in production (persistent across cold starts) and falls
  // back to local SQLite in dev.
  const [releases, allRatings] = await Promise.all([
    fetchFullCollection(),
    listAllRatings(),
  ]);
  const ratingMap: Record<number, number> = {};
  for (const r of allRatings) ratingMap[r.releaseId] = r.rating;
  return <CollectionGrid releases={releases} ratingMap={ratingMap} />;
}

// Latest collection-value snapshot — a single Redis read, never the slow
// live price build. Streams in under the header; renders nothing until the
// first snapshot exists.
async function HeaderValue() {
  const snapshot = await getLatestSnapshot();
  if (!snapshot) return null;
  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(snapshot.total);
  return (
    <Link
      href="/stats"
      className="inline-flex items-baseline gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      Collection value
      <span className="font-semibold text-primary tabular-nums">
        {formatted}
      </span>
      <span className="text-xs text-muted-foreground/70">
        as of {snapshot.date}
      </span>
    </Link>
  );
}

function CollectionSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-7">
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-10 space-y-1.5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary/80 font-medium">
          Your Library
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          The whole collection.
        </h1>
        <p className="text-sm text-muted-foreground">
          Search anything, spin a random record, or click in for tracklists and trivia.
        </p>
        <Suspense fallback={null}>
          <HeaderValue />
        </Suspense>
      </div>
      <Suspense fallback={<CollectionSkeleton />}>
        <Collection />
      </Suspense>
    </div>
  );
}
