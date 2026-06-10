import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const listens = sqliteTable("listens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: integer("release_id").notNull(),
  listenedAt: text("listened_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  notes: text("notes"),
});

export const ratings = sqliteTable("ratings", {
  releaseId: integer("release_id").primaryKey(),
  rating: real("rating").notNull(),
  notes: text("notes"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Cached marketplace floor prices per release. Populated lazily by the
// collection-prices API; rows older than 24h are refetched from Discogs.
// Persists across dev-server restarts locally; on Vercel's /tmp it survives
// warm starts but is wiped on cold starts.
export const releasePrices = sqliteTable("release_prices", {
  releaseId: integer("release_id").primaryKey(),
  // null = no copies currently for sale on Discogs for this release.
  price: real("price"),
  currency: text("currency"),
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Weekly (and on-demand) snapshots of total collection value. One row per
// EST calendar date — re-snapshotting the same day replaces the row.
export const valueSnapshots = sqliteTable("value_snapshots", {
  date: text("date").primaryKey(), // YYYY-MM-DD (EST)
  total: real("total").notNull(),
  priced: integer("priced").notNull(), // releases with a known price
  count: integer("count").notNull(), // total releases in collection
});

// First price ever recorded per release — the baseline for gainer/loser
// math ("up $12 since tracking began").
export const priceBaselines = sqliteTable("price_baselines", {
  releaseId: integer("release_id").primaryKey(),
  price: real("price").notNull(),
  recordedAt: text("recorded_at").notNull(), // YYYY-MM-DD (EST)
});

export type Listen = typeof listens.$inferSelect;
export type NewListen = typeof listens.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type ReleasePrice = typeof releasePrices.$inferSelect;
export type ValueSnapshot = typeof valueSnapshots.$inferSelect;
