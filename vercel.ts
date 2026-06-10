import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Weekly collection-value snapshot, Sundays 13:00 UTC (~8-9am Eastern).
    // The stats page also lazily snapshots when the latest is >6 days old,
    // so this cron is the reliable path and the page visit is the fallback.
    { path: "/api/cron/value-snapshot", schedule: "0 13 * * 0" },
    // Daily wantlist price check, 11:00 UTC (~6-7am Eastern). The wantlist
    // page also lazily refreshes when the last check is >20h old.
    { path: "/api/cron/wantlist-check", schedule: "0 11 * * *" },
  ],
};
