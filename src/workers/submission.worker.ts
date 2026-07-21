import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { withJobRun } from "./jobRun";
import { prepareSubmission } from "@/services/submission/submissionService";
import { trackSubmission } from "@/services/submission/trackingService";
import { logger } from "@/lib/logging/logger";

/**
 * Phase 5 workers: submit (prepare/execute campaign submission) and track
 * (qualified views + estimated earnings). Both wrapped in idempotent JobRuns.
 * Run with `npm run worker:submission`.
 */

const submitWorker = new Worker(
  QUEUE_NAMES.submit,
  async (job) => {
    const publicationId = job.data.publicationId as string;
    return withJobRun(QUEUE_NAMES.submit, `submit:${publicationId}`, { publicationId }, () =>
      prepareSubmission(publicationId),
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

const trackWorker = new Worker(
  QUEUE_NAMES.track,
  async (job) => {
    const submissionId = job.data.submissionId as string;
    // Tracking is intentionally re-runnable (stats change), so no JobRun guard.
    return trackSubmission(submissionId);
  },
  { connection: redisConnection, concurrency: 3 },
);

for (const [name, w] of [
  ["submit", submitWorker],
  ["track", trackWorker],
] as const) {
  w.on("completed", (job) => logger.info({ worker: name, jobId: job.id }, "job completed"));
  w.on("failed", (job, err) => logger.error({ worker: name, jobId: job?.id, err }, "job failed"));
}

logger.info("Submission + tracking workers started");
