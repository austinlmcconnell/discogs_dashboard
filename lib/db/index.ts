import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Pick a writable DB path that works in every runtime:
//   - DATABASE_URL set         → honor it
//   - on Vercel (VERCEL=1)     → /tmp (writable, but EPHEMERAL — data is lost
//                                between cold starts / deploys). Suitable for
//                                "it runs" demo; swap to a managed DB
//                                (Vercel Marketplace: Neon Postgres / Turso)
//                                before relying on ratings/listens to persist.
//   - local dev                → ./data/dashboard.db (writable, persistent)
const defaultDbPath = process.env.VERCEL
  ? "file:/tmp/dashboard.db"
  : "file:./data/dashboard.db";
const dbUrl = process.env.DATABASE_URL ?? defaultDbPath;
const dbPath = dbUrl.replace(/^file:/, "");
const absolute = path.isAbsolute(dbPath)
  ? dbPath
  : path.join(process.cwd(), dbPath);

fs.mkdirSync(path.dirname(absolute), { recursive: true });

const sqlite = new Database(absolute);
sqlite.pragma("journal_mode = WAL");

// Idempotent schema bootstrap. With no migrations checked in (drizzle/ is
// empty), the only guarantee that these tables exist comes from a manual
// `drizzle-kit push` run by the developer. That doesn't fire on Vercel cold
// starts where the DB lives in ephemeral /tmp — so we recreate the schema on
// every connect. CREATE TABLE IF NOT EXISTS is cheap when tables are present.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS listens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL,
    listened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS ratings (
    release_id INTEGER PRIMARY KEY,
    rating REAL NOT NULL,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

export const db = drizzle(sqlite, { schema });
export { schema };
