import { db } from "@/lib/db";
import { priceBaselines, releasePrices, valueSnapshots } from "@/lib/db/schema";
import { buildPriceMap } from "@/lib/prices";
import { getRedis } from "@/lib/redis";

// Collection-value tracking. Same two-backend pattern as listens/ratings:
// Upstash Redis in production, SQLite locally.
//
// Redis layout:
//   value:snapshots     HASH  date(YYYY-MM-DD EST) → {total, priced, count}
//   value:baselines     HASH  releaseId → {price, recordedAt}
//   value:latest-prices STRING JSON {releaseId: price|null} — written at
//                       snapshot time so gainer/loser reads never need the
//                       (potentially slow) live price build.
//
// Snapshots are keyed by EST calendar date — taking two snapshots the same
// day just overwrites, so the series stays one-point-per-day at most.
//
// READ paths catch errors and return safe defaults so the stats page never
// crashes on a backend hiccup. takeSnapshot lets errors bubble to callers
// (cron reports failure; the after()-trigger catches its own).

export type ValueSnapshot = {
  date: string; // YYYY-MM-DD (EST)
  total: number;
  priced: number;
  count: number;
};

export type PriceBaseline = { price: number; recordedAt: string };

const SNAPSHOTS_KEY = "value:snapshots";
const BASELINES_KEY = "value:baselines";
const LATEST_PRICES_KEY = "value:latest-prices";

function todayEst(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getSnapshots(): Promise<ValueSnapshot[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const all = await redis.hgetall<
        Record<string, Omit<ValueSnapshot, "date">>
      >(SNAPSHOTS_KEY);
      if (!all) return [];
      return Object.entries(all)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      console.error("[value-store] redis getSnapshots failed:", err);
      return [];
    }
  }
  try {
    return db
      .select()
      .from(valueSnapshots)
      .all()
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error("[value-store] sqlite getSnapshots failed:", err);
    return [];
  }
}

export async function getLatestSnapshot(): Promise<ValueSnapshot | null> {
  const snapshots = await getSnapshots();
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

export async function getBaselines(): Promise<Record<number, PriceBaseline>> {
  const redis = getRedis();
  if (redis) {
    try {
      const all = await redis.hgetall<Record<string, PriceBaseline>>(
        BASELINES_KEY,
      );
      if (!all) return {};
      const out: Record<number, PriceBaseline> = {};
      for (const [k, v] of Object.entries(all)) out[Number(k)] = v;
      return out;
    } catch (err) {
      console.error("[value-store] redis getBaselines failed:", err);
      return {};
    }
  }
  try {
    const rows = db.select().from(priceBaselines).all();
    const out: Record<number, PriceBaseline> = {};
    for (const r of rows)
      out[r.releaseId] = { price: r.price, recordedAt: r.recordedAt };
    return out;
  } catch (err) {
    console.error("[value-store] sqlite getBaselines failed:", err);
    return {};
  }
}

// Prices as of the most recent snapshot — instant read, never triggers the
// slow live price build.
export async function getLatestPrices(): Promise<Record<
  number,
  number | null
> | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return (
        (await redis.get<Record<number, number | null>>(LATEST_PRICES_KEY)) ??
        null
      );
    } catch (err) {
      console.error("[value-store] redis getLatestPrices failed:", err);
      return null;
    }
  }
  try {
    // SQLite path: the release_prices cache table doubles as latest-known
    // prices (including stale rows — better stale than missing for display).
    const rows = db.select().from(releasePrices).all();
    if (rows.length === 0) return null;
    const out: Record<number, number | null> = {};
    for (const r of rows) out[r.releaseId] = r.price;
    return out;
  } catch (err) {
    console.error("[value-store] sqlite getLatestPrices failed:", err);
    return null;
  }
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export async function takeSnapshot(): Promise<ValueSnapshot> {
  const prices = await buildPriceMap();
  const date = todayEst();

  let total = 0;
  let priced = 0;
  const count = Object.keys(prices).length;
  for (const v of Object.values(prices)) {
    if (v != null) {
      total += v;
      priced++;
    }
  }
  total = Math.round(total * 100) / 100;
  const snapshot: ValueSnapshot = { date, total, priced, count };

  const redis = getRedis();
  if (redis) {
    const existingBaselines = await redis.hgetall<
      Record<string, PriceBaseline>
    >(BASELINES_KEY);
    const newBaselines: Record<string, PriceBaseline> = {};
    for (const [idStr, price] of Object.entries(prices)) {
      if (price != null && !(existingBaselines ?? {})[idStr]) {
        newBaselines[idStr] = { price, recordedAt: date };
      }
    }
    const pipeline = redis.pipeline();
    pipeline.hset(SNAPSHOTS_KEY, {
      [date]: { total, priced, count },
    });
    pipeline.set(LATEST_PRICES_KEY, prices);
    if (Object.keys(newBaselines).length > 0) {
      pipeline.hset(BASELINES_KEY, newBaselines);
    }
    await pipeline.exec();
    return snapshot;
  }

  // SQLite path
  db.insert(valueSnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: valueSnapshots.date,
      set: { total, priced, count },
    })
    .run();
  for (const [idStr, price] of Object.entries(prices)) {
    if (price == null) continue;
    db.insert(priceBaselines)
      .values({ releaseId: Number(idStr), price, recordedAt: date })
      .onConflictDoNothing()
      .run();
  }
  return snapshot;
}

// Take a snapshot only when the latest one is older than maxAgeDays (or none
// exists). Used as a lazy fallback from page views so value history keeps
// accumulating even if the cron never fires. Swallows errors — this runs in
// a fire-and-forget after() context.
export async function takeSnapshotIfStale(maxAgeDays = 6): Promise<void> {
  try {
    const latest = await getLatestSnapshot();
    if (latest) {
      const ageMs =
        new Date(`${todayEst()}T12:00:00Z`).getTime() -
        new Date(`${latest.date}T12:00:00Z`).getTime();
      if (ageMs < maxAgeDays * 24 * 60 * 60 * 1000) return;
    }
    await takeSnapshot();
  } catch (err) {
    console.error("[value-store] takeSnapshotIfStale failed:", err);
  }
}
