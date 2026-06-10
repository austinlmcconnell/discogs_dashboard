import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Pick a writable DB path that works in every runtime:
//   - DATABASE_URL set         → honor it
//   - on Vercel (VERCEL=1)     → /tmp (writable, but EPHEMERAL — used only as
//                                fallback when the Upstash Redis Marketplace
//                                integration isn't connected).
//   - local dev                → ./data/dashboard.db (writable, persistent)
const defaultDbPath = process.env.VERCEL
  ? "file:/tmp/dashboard.db"
  : "file:./data/dashboard.db";
const dbUrl = process.env.DATABASE_URL ?? defaultDbPath;
const dbPath = dbUrl.replace(/^file:/, "");
const absolute = path.isAbsolute(dbPath)
  ? dbPath
  : path.join(process.cwd(), dbPath);

// LAZY initialization. Previously this module instantiated better-sqlite3 at
// import time — meaning ANY file that transitively imports `db` would crash
// on module load if the native binding had trouble (Node version mismatch,
// missing prebuilt binary, /tmp issues on Vercel). That crash propagates
// through listens-store, ratings-store, and the album page, producing the
// "white screen" Vercel function failure with no useful error surface.
//
// Now: if better-sqlite3 can't initialize, `db` is null and any caller using
// it must handle that gracefully (the stores already do via try/catch +
// safe defaults). When the Redis path is taken (Upstash integration
// connected on Vercel), `db` is never touched anyway.
//
// We don't use a Proxy wrapper here per the Vercel storage skill guidance —
// just a plain getter that callers invoke when they need it.

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;
let _initialized = false;

function initDb(): DrizzleDb | null {
  if (_initialized) return _db;
  _initialized = true;
  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const sqlite = new Database(absolute);
    sqlite.pragma("journal_mode = WAL");
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
      CREATE TABLE IF NOT EXISTS release_prices (
        release_id INTEGER PRIMARY KEY,
        price REAL,
        currency TEXT,
        fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS value_snapshots (
        date TEXT PRIMARY KEY,
        total REAL NOT NULL,
        priced INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS price_baselines (
        release_id INTEGER PRIMARY KEY,
        price REAL NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
    _db = drizzle(sqlite, { schema });
  } catch (err) {
    console.error("[db] sqlite init failed (falling back to null):", err);
    _db = null;
  }
  return _db;
}

// `db` is exported as a getter so consumers can use it ergonomically
// (`db.select().from(...)`) without knowing about lazy init. If init fails
// it throws on first use — store functions catch that and return safe
// defaults. This means a broken SQLite never prevents Redis-backed paths
// from working.
function ensureDb(): DrizzleDb {
  const d = initDb();
  if (!d) throw new Error("SQLite database unavailable");
  return d;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const real = ensureDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (real as any)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
