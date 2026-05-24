import { Redis } from "@upstash/redis";

// Lazy-init Upstash Redis singleton. Returns null when env vars are absent
// (typical local dev without `vercel env pull`), so callers can decide to
// fall back to local SQLite for development convenience.
//
// Both the canonical UPSTASH_* env-var names and the legacy KV_* names are
// supported so the same code works whether the Vercel project was provisioned
// via the modern Upstash for Redis Marketplace integration or via an older
// Vercel-KV-era setup.
//
// `new Redis({...})` is wrapped in try/catch so a malformed env var can't
// crash a route handler at the moment getRedis() is first called.
let _redis: Redis | null = null;
let _checked = false;

export function getRedis(): Redis | null {
  if (_checked) return _redis;
  _checked = true;
  try {
    const url =
      process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (url && token) {
      _redis = new Redis({ url, token });
    }
  } catch (err) {
    console.error("[redis] client init failed:", err);
    _redis = null;
  }
  return _redis;
}
