import type { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { logger } from "@/lib/logging/logger";

/**
 * Graceful shutdown for worker processes. On SIGTERM/SIGINT we stop accepting
 * new jobs and wait for in-flight jobs to finish (BullMQ `worker.close()` drains
 * active jobs) so an ffmpeg render, an upload, or a database write is never
 * abandoned mid-flight. A hard-kill timeout bounds the wait.
 */
export function registerGracefulShutdown(workers: Worker[], timeoutMs = 30_000): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, workers: workers.length }, "Graceful shutdown: draining active jobs");

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, "Shutdown timed out; forcing exit");
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    try {
      // close() stops fetching new jobs and resolves once active jobs complete.
      await Promise.all(workers.map((w) => w.close()));
      await redisConnection.quit().catch(() => undefined);
      clearTimeout(timer);
      logger.info("Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException");
    void shutdown("uncaughtException");
  });
}
