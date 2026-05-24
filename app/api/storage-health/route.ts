import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

// Diagnostic endpoint: hit this in a browser to see which storage backend
// the app is using and whether it can talk to it. Useful for verifying that
// the Upstash for Redis Marketplace integration is wired up correctly after
// a deploy.
//
// Returns 200 with JSON describing the backend, env-var presence, a
// round-trip ping result, and counts. Never throws — if Redis is unreachable
// we report that fact rather than 500.
export const dynamic = "force-dynamic";

type HealthResponse = {
  backend: "redis" | "sqlite";
  env: {
    UPSTASH_REDIS_REST_URL: boolean;
    UPSTASH_REDIS_REST_TOKEN: boolean;
    KV_REST_API_URL: boolean;
    KV_REST_API_TOKEN: boolean;
    VERCEL: boolean;
  };
  redis?: {
    reachable: boolean;
    listens_releases?: number;
    ratings_releases?: number;
    error?: string;
  };
};

export async function GET() {
  const env: HealthResponse["env"] = {
    UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    VERCEL: Boolean(process.env.VERCEL),
  };

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json<HealthResponse>({ backend: "sqlite", env });
  }

  try {
    // smembers on the two index sets is the cheapest reachable-Redis probe
    // that also tells us how much data is stored. Both calls in parallel.
    const [listensIds, ratingsIds] = await Promise.all([
      redis.smembers("listens:index"),
      redis.smembers("ratings:index"),
    ]);
    return NextResponse.json<HealthResponse>({
      backend: "redis",
      env,
      redis: {
        reachable: true,
        listens_releases: listensIds.length,
        ratings_releases: ratingsIds.length,
      },
    });
  } catch (err) {
    return NextResponse.json<HealthResponse>({
      backend: "redis",
      env,
      redis: {
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
