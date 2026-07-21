import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { withJobRun } from "./jobRun";
import { registerGracefulShutdown } from "./shutdown";
import { prepareSubmission } from "@/services/submission/submissionService";
import { trackSubmission } from "@/services/submission/trackingService";
import { syncMetrics } from "@/services/submission/metricsService";
import { syncEarnings } from "@/services/submission/earningsService";
import { logger } from "@/lib/logging/logger";
import { validateDeploymentEnv } from "@/lib/config/deployEnv";

validateDeploymentEnv();

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

const metricsWorker = new Worker(
  QUEUE_NAMES.metricsSync,
  async (job) => syncMetrics(job.data.publicationId as string),
  { connection: redisConnection, concurrency: 3 },
);

const earningsWorker = new Worker(
  QUEUE_NAMES.earningsSync,
  async (job) => syncEarnings(job.data.submissionId as string),
  { connection: redisConnection, concurrency: 3 },
);

for (const [name, w] of [
  ["submit", submitWorker],
  ["track", trackWorker],
  ["metrics-sync", metricsWorker],
  ["earnings-sync", earningsWorker],
] as const) {
  w.on("completed", (job) => logger.info({ worker: name, jobId: job.id }, "job completed"));
  w.on("failed", (job, err) => logger.error({ worker: name, jobId: job?.id, err }, "job failed"));
}

logger.info("Submission + tracking workers started");

registerGracefulShutdown([submitWorker, trackWorker, metricsWorker, earningsWorker]);
