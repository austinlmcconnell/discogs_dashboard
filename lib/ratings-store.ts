import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ratings } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

// Persistent storage for per-release ratings. Same two-backend pattern as
// listens-store: Upstash Redis when env vars are set, local SQLite otherwise.
//
// Redis layout:
//   - rating:<releaseId> = JSON Rating object (auto-encoded by @upstash/redis)
//   - ratings:index      = SET of release IDs that have a rating. Used by
//                          `listAllRatings()` so we don't have to do a KEYS
//                          scan (O(N) over all Redis keys, anti-pattern).
//
// READ paths catch errors and return safe defaults so a transient Redis
// failure doesn't take down the page render. WRITE paths let errors bubble
// so the caller can surface a toast.

export type Rating = {
  releaseId: number;
  rating: number;
  notes: string | null;
  updatedAt: string;
};

const RATING_KEY = (releaseId: number) => `rating:${releaseId}`;
const INDEX_KEY = "ratings:index";

export async function getRating(releaseId: number): Promise<Rating | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.get<Rating>(RATING_KEY(releaseId))) ?? null;
    } catch (err) {
      console.error("[ratings-store] redis getRating failed:", err);
      return null;
    }
  }
  try {
    const row = db
      .select()
      .from(ratings)
      .where(eq(ratings.releaseId, releaseId))
      .get();
    return row ?? null;
  } catch (err) {
    console.error("[ratings-store] sqlite getRating failed:", err);
    return null;
  }
}

export async function setRating(
  releaseId: number,
  rating: number,
  notes?: string | null,
): Promise<Rating> {
  const entry: Rating = {
    releaseId,
    rating,
    notes: notes ?? null,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  if (redis) {
    await redis.set(RATING_KEY(releaseId), entry);
    await redis.sadd(INDEX_KEY, releaseId);
    return entry;
  }
  const row = db
    .insert(ratings)
    .values({ releaseId, rating, notes: notes ?? null })
    .onConflictDoUpdate({
      target: ratings.releaseId,
      set: {
        rating,
        notes: notes ?? null,
        updatedAt: entry.updatedAt,
      },
    })
    .returning()
    .get();
  return row;
}

export async function deleteRating(releaseId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(RATING_KEY(releaseId));
    await redis.srem(INDEX_KEY, releaseId);
    return;
  }
  db.delete(ratings).where(eq(ratings.releaseId, releaseId)).run();
}

export async function listAllRatings(): Promise<Rating[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const ids = await redis.smembers(INDEX_KEY);
      if (ids.length === 0) return [];
      const keys = ids.map((id) => RATING_KEY(Number(id)));
      const values = await redis.mget<(Rating | null)[]>(...keys);
      return values.filter((v): v is Rating => v !== null);
    } catch (err) {
      console.error("[ratings-store] redis listAllRatings failed:", err);
      return [];
    }
  }
  try {
    return db.select().from(ratings).all();
  } catch (err) {
    console.error("[ratings-store] sqlite listAllRatings failed:", err);
    return [];
  }
}
