import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listens } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

// Persistent storage for per-release listens. Two backends:
//   - Upstash Redis (production / when env vars are set). Listens are stored
//     as a Redis LIST keyed `listens:<releaseId>`, newest at head via LPUSH.
//     A global counter at `listens:next-id` mints unique IDs.
//   - Local SQLite (`listens` table) as a fallback for local dev without the
//     Vercel env-pull. Same shape, just slower to migrate to prod since data
//     lives in two places.
//
// READ paths catch errors and return empty results so a transient Redis
// failure doesn't take down the page render. WRITE paths let errors bubble
// so the caller can surface a toast.

export type Listen = {
  id: number;
  releaseId: number;
  listenedAt: string;
  notes: string | null;
};

const LISTENS_KEY = (releaseId: number) => `listens:${releaseId}`;
const NEXT_ID_KEY = "listens:next-id";
const INDEX_KEY = "listens:index";

export async function listListens(releaseId: number): Promise<Listen[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const items = await redis.lrange<Listen>(LISTENS_KEY(releaseId), 0, -1);
      return [...items].sort((a, b) =>
        b.listenedAt.localeCompare(a.listenedAt),
      );
    } catch (err) {
      console.error("[listens-store] redis listListens failed:", err);
      return [];
    }
  }
  try {
    return db
      .select()
      .from(listens)
      .where(eq(listens.releaseId, releaseId))
      .orderBy(desc(listens.listenedAt))
      .all();
  } catch (err) {
    console.error("[listens-store] sqlite listListens failed:", err);
    return [];
  }
}

export async function listAllListens(limit = 200): Promise<Listen[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const ids = await redis.smembers(INDEX_KEY);
      if (ids.length === 0) return [];
      const all: Listen[] = [];
      for (const id of ids) {
        const items = await redis.lrange<Listen>(
          LISTENS_KEY(Number(id)),
          0,
          -1,
        );
        all.push(...items);
      }
      return all
        .sort((a, b) => b.listenedAt.localeCompare(a.listenedAt))
        .slice(0, limit);
    } catch (err) {
      console.error("[listens-store] redis listAllListens failed:", err);
      return [];
    }
  }
  try {
    return db
      .select()
      .from(listens)
      .orderBy(desc(listens.listenedAt))
      .limit(limit)
      .all();
  } catch (err) {
    console.error("[listens-store] sqlite listAllListens failed:", err);
    return [];
  }
}

export async function addListen(
  releaseId: number,
  notes?: string | null,
): Promise<Listen> {
  const redis = getRedis();
  if (redis) {
    const id = await redis.incr(NEXT_ID_KEY);
    const listen: Listen = {
      id,
      releaseId,
      listenedAt: new Date().toISOString(),
      notes: notes ?? null,
    };
    await redis.lpush(LISTENS_KEY(releaseId), listen);
    await redis.sadd(INDEX_KEY, releaseId);
    return listen;
  }
  const row = db
    .insert(listens)
    .values({ releaseId, notes: notes ?? null })
    .returning()
    .get();
  return row;
}
