import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { withJobRun } from "./jobRun";
import { publishClip } from "@/services/publishing/publishService";
import { logger } from "@/lib/logging/logger";
import type { Platform, PublicationMode } from "@/generated/prisma";

/**
 * Phase 4 worker: publish. Each job is wrapped in an idempotent JobRun; the
 * publish service itself is also idempotent on (clip, platform, mode) so a post
 * is never created twice. Run with `npm run worker:publish`.
 */
const publishWorker = new Worker(
  QUEUE_NAMES.publish,
  async (job) => {
    const { renderedClipId, platform, mode } = job.data as {
      renderedClipId: string;
      platform: Platform;
      mode: PublicationMode;
    };
    const key = `publish:${renderedClipId}:${platform}:${mode}`;
    return withJobRun(QUEUE_NAMES.publish, key, { renderedClipId, platform, mode }, () =>
      publishClip({ renderedClipId, platform, mode }),
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

publishWorker.on("completed", (job) => logger.info({ jobId: job.id }, "publish job completed"));
publishWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "publish job failed"));

logger.info("Publish worker started");
