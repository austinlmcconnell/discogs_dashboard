import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Weekly collection-value snapshot, Sundays 13:00 UTC (~8-9am Eastern).
    // The stats page also lazily snapshots when the latest is >6 days old,
    // so this cron is the reliable path and the page visit is the fallback.
    { path: "/api/cron/value-snapshot", schedule: "0 13 * * 0" },
  ],
};
