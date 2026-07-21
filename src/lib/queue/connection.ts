import { Redis } from "ioredis";
import { env } from "@/lib/config/env";

/**
 * Shared Redis connection for BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` on the connection it uses for blocking ops.
 */

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redisConnection =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redisConnection;
}
