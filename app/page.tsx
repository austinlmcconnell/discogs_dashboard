import { Suspense } from "react";
import { fetchFullCollection } from "@/lib/discogs";
import { CollectionGrid } from "@/components/collection-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { listAllRatings } from "@/lib/ratings-store";

export const revalidate = 3600;

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
      </div>
      <Suspense fallback={<CollectionSkeleton />}>
        <Collection />
      </Suspense>
    </div>
  );
}
