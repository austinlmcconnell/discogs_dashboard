// Pure pick logic for Smart Spin. No IO — works on slim candidate records
// so it can run server-side (tonight's queue) and client-side (mode buttons)
// with the same behavior.

export type SpinCandidate = {
  id: number;
  // Days since the most recent listen; null = never played.
  daysSince: number | null;
  rating: number | null;
};

// A record counts as "dusty" if never played or untouched for 6+ months.
export const DUSTY_DAYS = 180;

// Whole days elapsed since an epoch-ms timestamp; null for "never".
// Lives here (not in a component) so server components can derive
// listen-recency without tripping the react-hooks/purity rule on Date.now().
export function daysSince(lastEpochMs: number | null | undefined): number | null {
  if (lastEpochMs == null) return null;
  return Math.floor((Date.now() - lastEpochMs) / (24 * 60 * 60 * 1000));
}

// ─── Surprise me: weighted random, biased toward neglected records ─────────
//
// Weight grows linearly with days-since-last-listen, capped at a year so
// ancient listens don't dominate, and never-played records get a bonus above
// the cap. A record played yesterday can still come up — just rarely.
export function surpriseWeight(c: SpinCandidate): number {
  if (c.daysSince == null) return 400;
  return Math.max(1, Math.min(c.daysSince, 365));
}

export function pickSurprise(
  candidates: SpinCandidate[],
  excludeIds: ReadonlySet<number> = new Set(),
): SpinCandidate | null {
  const pool = candidates.filter((c) => !excludeIds.has(c.id));
  if (pool.length === 0) return null;
  const totalWeight = pool.reduce((a, c) => a + surpriseWeight(c), 0);
  let roll = Math.random() * totalWeight;
  for (const c of pool) {
    roll -= surpriseWeight(c);
    if (roll <= 0) return c;
  }
  return pool[pool.length - 1];
}

// ─── Dusty corner: uniform among the neglected ──────────────────────────────

export function dustyPool(candidates: SpinCandidate[]): SpinCandidate[] {
  return candidates.filter(
    (c) => c.daysSince == null || c.daysSince >= DUSTY_DAYS,
  );
}

// ─── Comfort spin: your highest-rated records ───────────────────────────────
//
// Prefers 8+, relaxes to 7+ then to anything rated, so the mode still works
// for harsh graders. Returns the threshold used so the UI can label it.
export function comfortPool(candidates: SpinCandidate[]): {
  pool: SpinCandidate[];
  minRating: number | null;
} {
  for (const min of [8, 7]) {
    const pool = candidates.filter((c) => c.rating != null && c.rating >= min);
    if (pool.length > 0) return { pool, minRating: min };
  }
  const anyRated = candidates.filter((c) => c.rating != null);
  return { pool: anyRated, minRating: anyRated.length > 0 ? 1 : null };
}

// ─── Shared ─────────────────────────────────────────────────────────────────

export function pickUniform(
  pool: SpinCandidate[],
  excludeIds: ReadonlySet<number> = new Set(),
): SpinCandidate | null {
  const filtered = pool.filter((c) => !excludeIds.has(c.id));
  if (filtered.length === 0) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}
