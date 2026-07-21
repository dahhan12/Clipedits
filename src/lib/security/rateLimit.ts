import { NextResponse } from "next/server";
import { redisConnection } from "@/lib/queue/connection";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

/**
 * Distributed fixed-window rate limiting backed by Redis, so limits hold across
 * multiple application instances (unlike the per-instance edge middleware). The
 * INCR+EXPIRE is atomic via a Lua script.
 *
 * Fail-open: if Redis is unreachable we allow the request (availability over a
 * hard denial) but log it, so an outage cannot lock everyone out.
 */

const LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
  retryAfterSec: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const redisKey = `rl:${key}:${bucket}`;
  try {
    const n = (await redisConnection.eval(LUA, 1, redisKey, String(windowSec))) as number;
    const remaining = Math.max(0, limit - n);
    return {
      ok: n <= limit,
      remaining,
      limit,
      retryAfterSec: n <= limit ? 0 : windowSec - (Math.floor(Date.now() / 1000) % windowSec),
    };
  } catch (err) {
    logger.warn({ err, key }, "Rate limiter unavailable; failing open");
    return { ok: true, remaining: limit, limit, retryAfterSec: 0 };
  }
}

/** Named limits for sensitive operations (independent buckets). */
export const LIMITS = {
  login: { limit: 10, windowSec: 300 }, // 10 / 5 min per IP
  publish: { limit: 30, windowSec: 60 },
  submit: { limit: 30, windowSec: 60 },
  reparse: { limit: 60, windowSec: 60 },
  download: { limit: 30, windowSec: 60 },
  clipGen: { limit: 60, windowSec: 60 },
  campaignCreate: { limit: 30, windowSec: 60 },
  perUser: { limit: env.RATE_LIMIT_PER_MINUTE, windowSec: 60 },
} as const;

/** Client IP from a request (best-effort behind the proxy). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Returns a ready 429 NextResponse when limited, or null when allowed. */
export async function rateLimitOr429(
  name: keyof typeof LIMITS,
  scope: string,
): Promise<NextResponse | null> {
  const r = await enforce(name, scope);
  if (!r) return null;
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

/**
 * Enforce a named limit scoped by one or more dimensions. Returns null when
 * allowed, or a 429 body/headers descriptor when limited.
 */
export async function enforce(
  name: keyof typeof LIMITS,
  scope: string,
): Promise<{ status: 429; retryAfterSec: number } | null> {
  const cfg = LIMITS[name];
  const res = await rateLimit(`${name}:${scope}`, cfg.limit, cfg.windowSec);
  return res.ok ? null : { status: 429, retryAfterSec: res.retryAfterSec };
}
