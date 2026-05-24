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
// The choice is made at call time based on env vars — there's no toggling
// behavior. On Vercel the Redis path is always taken because the Marketplace
// integration auto-sets UPSTASH_REDIS_REST_URL / _TOKEN.

export type Listen = {
  id: number;
  releaseId: number;
  listenedAt: string;
  notes: string | null;
};

const LISTENS_KEY = (releaseId: number) => `listens:${releaseId}`;
const NEXT_ID_KEY = "listens:next-id";
// Tracks every release that has at least one listen, so `listAllListens()`
// can enumerate without a slow KEYS-scan.
const INDEX_KEY = "listens:index";

export async function listListens(releaseId: number): Promise<Listen[]> {
  const redis = getRedis();
  if (redis) {
    const items = await redis.lrange<Listen>(LISTENS_KEY(releaseId), 0, -1);
    // LPUSH puts newest at head, so LRANGE 0..-1 is already
    // newest-first — sort defensively in case rows were inserted out-of-order.
    return [...items].sort((a, b) =>
      b.listenedAt.localeCompare(a.listenedAt),
    );
  }
  return db
    .select()
    .from(listens)
    .where(eq(listens.releaseId, releaseId))
    .orderBy(desc(listens.listenedAt))
    .all();
}

export async function listAllListens(limit = 200): Promise<Listen[]> {
  const redis = getRedis();
  if (redis) {
    const ids = await redis.smembers(INDEX_KEY);
    if (ids.length === 0) return [];
    const all: Listen[] = [];
    for (const id of ids) {
      const items = await redis.lrange<Listen>(LISTENS_KEY(Number(id)), 0, -1);
      all.push(...items);
    }
    return all
      .sort((a, b) => b.listenedAt.localeCompare(a.listenedAt))
      .slice(0, limit);
  }
  return db
    .select()
    .from(listens)
    .orderBy(desc(listens.listenedAt))
    .limit(limit)
    .all();
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
