import type { Listen } from "@/lib/listens-store";

// Client-side helper shared by ListenLog and the Now Spinning overlay:
// log a listen and (optionally, in parallel) set the album's rating.
// Throws on failure so callers can toast.
export async function logListenWithRating(
  releaseId: number,
  opts: { notes?: string; rating?: number | null },
): Promise<Listen> {
  const listenPromise = fetch(`/api/listens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ releaseId, notes: opts.notes || undefined }),
  });
  // Only PUT the rating when one is set — a cleared rating shouldn't
  // persist a zero.
  const ratingPromise =
    opts.rating != null
      ? fetch(`/api/ratings/${releaseId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: opts.rating }),
        })
      : Promise.resolve(null);

  const [listenRes, ratingRes] = await Promise.all([
    listenPromise,
    ratingPromise,
  ]);
  if (!listenRes.ok) throw new Error("listen failed");
  if (ratingRes && !ratingRes.ok) throw new Error("rating failed");

  const { listen } = (await listenRes.json()) as { listen: Listen };
  return listen;
}
