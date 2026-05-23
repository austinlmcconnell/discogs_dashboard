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

export type Listen = typeof listens.$inferSelect;
export type NewListen = typeof listens.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
