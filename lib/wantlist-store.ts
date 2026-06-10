import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wantlistAlerts, wantlistPrices } from "@/lib/db/schema";
import { fetchMarketplaceStats, fetchWantlist } from "@/lib/discogs";
import { throttledRun } from "@/lib/prices";
import { getRedis } from "@/lib/redis";

// Wantlist price watching. Tracks the current marketplace floor for every
// release on the user's Discogs wantlist and records an alert when:
//   - the price DROPS meaningfully (≥ $1 AND ≥ 5% below the previous check), or
//   - a release with NO copies for sale becomes available again.
//
// First sighting of a release (no previous entry) records the price silently —
// otherwise adding 30 wants would instantly spam 30 "alerts".
//
// Same two-backend pattern as everything else: Redis in production, SQLite
// locally. READ paths fail safe; refresh paths let errors bubble to the cron
// (the lazy after()-trigger catches its own).

export type WantPrice = {
  price: number | null; // null = no copies currently for sale
  numForSale: number | null;
  checkedAt: string; // ISO
};

export type WantAlert = {
  releaseId: number;
  oldPrice: number | null; // null = was unavailable, now listed
  newPrice: number;
  date: string; // ISO
};

const PRICES_KEY = "wantlist:prices";
const ALERTS_KEY = "wantlist:alerts";
const LASTCHECK_KEY = "wantlist:lastcheck";
const MAX_ALERTS = 50;
const THROTTLE_MS = 850;

function isDrop(oldPrice: number, newPrice: number): boolean {
  const delta = oldPrice - newPrice;
  return delta >= 1 && delta >= oldPrice * 0.05;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getWantPrices(): Promise<Record<number, WantPrice>> {
  const redis = getRedis();
  if (redis) {
    try {
      const all = await redis.hgetall<Record<string, WantPrice>>(PRICES_KEY);
      if (!all) return {};
      const out: Record<number, WantPrice> = {};
      for (const [k, v] of Object.entries(all)) out[Number(k)] = v;
      return out;
    } catch (err) {
      console.error("[wantlist-store] redis getWantPrices failed:", err);
      return {};
    }
  }
  try {
    const rows = db.select().from(wantlistPrices).all();
    const out: Record<number, WantPrice> = {};
    for (const r of rows) {
      out[r.releaseId] = {
        price: r.price,
        numForSale: r.numForSale,
        checkedAt: r.checkedAt,
      };
    }
    return out;
  } catch (err) {
    console.error("[wantlist-store] sqlite getWantPrices failed:", err);
    return {};
  }
}

export async function getRecentAlerts(days = 30): Promise<WantAlert[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const redis = getRedis();
  if (redis) {
    try {
      const items = await redis.lrange<WantAlert>(ALERTS_KEY, 0, MAX_ALERTS - 1);
      return items.filter((a) => a.date >= cutoff);
    } catch (err) {
      console.error("[wantlist-store] redis getRecentAlerts failed:", err);
      return [];
    }
  }
  try {
    const rows = db
      .select()
      .from(wantlistAlerts)
      .where(sql`created_at >= ${cutoff}`)
      .orderBy(desc(wantlistAlerts.createdAt))
      .limit(MAX_ALERTS)
      .all();
    return rows.map((r) => ({
      releaseId: r.releaseId,
      oldPrice: r.oldPrice,
      newPrice: r.newPrice ?? 0,
      date: r.createdAt,
    }));
  } catch (err) {
    console.error("[wantlist-store] sqlite getRecentAlerts failed:", err);
    return [];
  }
}

async function getLastCheck(): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.get<string>(LASTCHECK_KEY)) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const rows = db
      .select({ max: sql<string>`MAX(checked_at)` })
      .from(wantlistPrices)
      .all();
    return rows[0]?.max ?? null;
  } catch {
    return null;
  }
}

// ─── Refresh ────────────────────────────────────────────────────────────────

export async function refreshWantlist(): Promise<{
  checked: number;
  alerts: WantAlert[];
}> {
  const wants = await fetchWantlist();
  const ids = wants.map((w) => w.basic_information.id);
  const previous = await getWantPrices();
  const now = new Date().toISOString();

  const stats = await throttledRun(
    ids,
    (id) => fetchMarketplaceStats(id),
    THROTTLE_MS,
  );

  const nextPrices: Record<number, WantPrice> = {};
  const newAlerts: WantAlert[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const price = stats[i]?.lowest_price?.value ?? null;
    const numForSale = stats[i]?.num_for_sale ?? null;
    nextPrices[id] = { price, numForSale, checkedAt: now };

    const prev = previous[id];
    if (!prev || price == null) continue; // first sighting or still unavailable
    if (prev.price == null) {
      // Was unavailable, now listed — the alert collectors actually want.
      newAlerts.push({ releaseId: id, oldPrice: null, newPrice: price, date: now });
    } else if (isDrop(prev.price, price)) {
      newAlerts.push({
        releaseId: id,
        oldPrice: prev.price,
        newPrice: price,
        date: now,
      });
    }
  }

  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    // Replace the whole hash so releases removed from the wantlist age out.
    pipeline.del(PRICES_KEY);
    const hashPayload: Record<string, WantPrice> = {};
    for (const [id, v] of Object.entries(nextPrices)) hashPayload[id] = v;
    if (Object.keys(hashPayload).length > 0) {
      pipeline.hset(PRICES_KEY, hashPayload);
    }
    if (newAlerts.length > 0) {
      pipeline.lpush(ALERTS_KEY, ...newAlerts);
      pipeline.ltrim(ALERTS_KEY, 0, MAX_ALERTS - 1);
    }
    pipeline.set(LASTCHECK_KEY, now);
    await pipeline.exec();
  } else {
    db.delete(wantlistPrices).run();
    for (const [idStr, v] of Object.entries(nextPrices)) {
      db.insert(wantlistPrices)
        .values({
          releaseId: Number(idStr),
          price: v.price,
          numForSale: v.numForSale,
          checkedAt: v.checkedAt,
        })
        .run();
    }
    for (const a of newAlerts) {
      db.insert(wantlistAlerts)
        .values({
          releaseId: a.releaseId,
          oldPrice: a.oldPrice,
          newPrice: a.newPrice,
          createdAt: a.date,
        })
        .run();
    }
  }

  return { checked: ids.length, alerts: newAlerts };
}

// Refresh only when the last check is older than maxAgeHours. Lazy fallback
// from page views; the daily cron is the primary path. Swallows errors —
// runs in a fire-and-forget after() context.
export async function refreshWantlistIfStale(maxAgeHours = 20): Promise<void> {
  try {
    const last = await getLastCheck();
    if (last) {
      const ageMs = Date.now() - new Date(last).getTime();
      if (ageMs < maxAgeHours * 60 * 60 * 1000) return;
    }
    await refreshWantlist();
  } catch (err) {
    console.error("[wantlist-store] refreshWantlistIfStale failed:", err);
  }
}
