import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware for the API surface:
 *  - CSRF: mutating requests must be same-origin (Origin header must match the
 *    request host). Cross-site form posts (which cannot set Origin freely to a
 *    matching value) are rejected.
 *  - Rate limiting: a per-instance fixed-window counter per client IP.
 *
 * Distributed rate limiting (Redis) can replace the in-memory window later; this
 * is edge-safe and dependency-free.
 */

const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "120");
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > LIMIT;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (MUTATING.has(req.method)) {
    const origin = req.headers.get("origin");
    // Same-origin check: when an Origin is present it must match the host.
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return NextResponse.json({ error: "Bad origin" }, { status: 403 });
      }
      if (originHost !== req.headers.get("host")) {
        return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
