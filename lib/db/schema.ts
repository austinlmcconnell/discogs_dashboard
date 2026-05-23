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

export type Listen = typeof listens.$inferSelect;
export type NewListen = typeof listens.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type ReleasePrice = typeof releasePrices.$inferSelect;
