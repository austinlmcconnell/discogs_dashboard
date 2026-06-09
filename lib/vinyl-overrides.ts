import { getRedis } from "@/lib/redis";

// Vinyl overrides are now fetched LIVE from the Google Sheet at request time
// (with caching). When the user adds a row to the sheet it takes effect on
// the dashboard within ~5-10 minutes — no manual `npm run sync-overrides`,
// no rebuild, no deploy.
//
// Two-tier cache:
//   - In-memory per Vercel function instance (5 min TTL). Cheapest read.
//   - Upstash Redis shared across instances (10 min TTL). Survives cold starts.
//
// On cache miss, fetch the CSV (~300ms), parse, populate both caches, return.
// On fetch failure, return null for the requested releaseId — the album page
// falls back to algorithmic detection.
//
// The Google Sheet is public; no auth needed for the export endpoint.

const SHEET_ID = "1UW3CLv5HQUVMdl-HjI1qzeNfrAmmZLlnE3isN-zo2Ak";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const REDIS_KEY = "overrides:map:v1";
const REDIS_TTL_SECONDS = 10 * 60; // 10 min
const MEM_TTL_MS = 5 * 60 * 1000; // 5 min

export type VinylOverride = {
  imageUrl: string;
  // "photo" = use as the vinyl image (cropped & circle-masked normally).
  // "svg"   = don't show a photo; parse the note's color/variant words and
  //          render the SVG fallback accordingly.
  kind: "photo" | "svg";
  // Free-form note from the sheet (e.g. "Dark brown with faint yellow swirl").
  note: string | null;
};

type OverrideMap = Record<number, VinylOverride>;

// ─── Memory cache + in-flight dedupe ────────────────────────────────────────

let memCache: { map: OverrideMap; at: number } | null = null;
let inflight: Promise<OverrideMap> | null = null;

// ─── CSV parser (RFC-4180-ish) ──────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM if present (Google sometimes adds one)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function extractReleaseId(url: string): number | null {
  const m = url.match(/\/release\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function rowsToMap(rows: string[][]): OverrideMap {
  const map: OverrideMap = {};
  // Skip header row.
  for (let i = 1; i < rows.length; i++) {
    const [albumUrl = "", imageUrl = "", note = ""] = rows[i];
    const releaseId = extractReleaseId(albumUrl.trim());
    const url = imageUrl.trim();
    if (!releaseId || !url) continue;
    const cleanNote = note.trim();
    map[releaseId] = {
      imageUrl: url,
      kind: cleanNote ? "svg" : "photo",
      note: cleanNote || null,
    };
  }
  return map;
}

async function fetchAndParseSheet(): Promise<OverrideMap> {
  // `cache: "no-store"` opts out of Next.js's fetch cache so OUR memory +
  // Redis caches are the only ones in play. Otherwise Next would return a
  // stale CSV for an hour from its built-in revalidate.
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();
  return rowsToMap(parseCsv(text));
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function loadMap(): Promise<OverrideMap> {
  // 1. In-memory (fastest)
  if (memCache && Date.now() - memCache.at < MEM_TTL_MS) {
    return memCache.map;
  }

  // 2. Redis (shared across function instances)
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<OverrideMap>(REDIS_KEY);
      if (cached) {
        memCache = { map: cached, at: Date.now() };
        return cached;
      }
    } catch (err) {
      console.error("[vinyl-overrides] redis read failed:", err);
      // Fall through to network fetch.
    }
  }

  // 3. Fetch the sheet. Dedupe overlapping calls so a burst of album loads
  //    after cache expiry only triggers one fetch.
  if (!inflight) {
    inflight = fetchAndParseSheet().finally(() => {
      inflight = null;
    });
  }
  const map = await inflight;
  memCache = { map, at: Date.now() };
  if (redis) {
    try {
      await redis.set(REDIS_KEY, map, { ex: REDIS_TTL_SECONDS });
    } catch (err) {
      console.error("[vinyl-overrides] redis write failed:", err);
    }
  }
  return map;
}

export async function getVinylOverride(
  releaseId: number,
): Promise<VinylOverride | null> {
  try {
    const map = await loadMap();
    return map[releaseId] ?? null;
  } catch (err) {
    console.error("[vinyl-overrides] loadMap failed:", err);
    return null;
  }
}
