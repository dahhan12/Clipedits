import { describe, it, expect, afterAll } from "vitest";
import { rateLimit } from "@/lib/security/rateLimit";
import { redisConnection } from "@/lib/queue/connection";

const hasRedis = !!process.env.REDIS_URL || true; // connection defaults to localhost
const d = hasRedis ? describe : describe.skip;

d("distributed rate limiting (integration, real Redis)", () => {
  afterAll(async () => {
    await redisConnection.quit().catch(() => undefined);
  });

  it("allows up to the limit then blocks within the window", async () => {
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit(key, 3, 60));
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(results.filter((r) => !r.ok).length).toBe(2);
    expect(results[4]!.retryAfterSec).toBeGreaterThan(0);
  });

  it("keeps independent buckets per key (per-IP / per-user isolation)", async () => {
    const a = `a-${Math.random().toString(36).slice(2)}`;
    const b = `b-${Math.random().toString(36).slice(2)}`;
    expect((await rateLimit(a, 1, 60)).ok).toBe(true);
    expect((await rateLimit(a, 1, 60)).ok).toBe(false);
    // A different key (different client) is unaffected.
    expect((await rateLimit(b, 1, 60)).ok).toBe(true);
  });
});
