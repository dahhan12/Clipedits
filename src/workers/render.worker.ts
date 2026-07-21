import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { withJobRun } from "./jobRun";
import { renderCandidate } from "@/services/render/renderService";
import { evaluateCompliance } from "@/services/compliance/complianceService";
import { logger } from "@/lib/logging/logger";

/**
 * Phase 3 workers: render → compliance. Render produces the 9:16 MP4 and, on
 * success, enqueues compliance. Both are wrapped in idempotent JobRuns so a
 * retry never re-renders or double-writes compliance results. Run with
 * `npm run worker:render`. Requires ffmpeg on PATH.
 */

const renderWorker = new Worker(
  QUEUE_NAMES.render,
  async (job) => {
    const candidateId = job.data.candidateId as string;
    return withJobRun(QUEUE_NAMES.render, `render:${candidateId}`, { candidateId }, () =>
      renderCandidate(candidateId),
    );
  },
  { connection: redisConnection, concurrency: 1 },
);

const complianceWorker = new Worker(
  QUEUE_NAMES.compliance,
  async (job) => {
    const renderedClipId = job.data.renderedClipId as string;
    return withJobRun(QUEUE_NAMES.compliance, `compliance:${renderedClipId}`, { renderedClipId }, () =>
      evaluateCompliance(renderedClipId),
    );
  },
  { connection: redisConnection, concurrency: 3 },
);

for (const [name, w] of [
  ["render", renderWorker],
  ["compliance", complianceWorker],
] as const) {
  w.on("completed", (job) => logger.info({ worker: name, jobId: job.id }, "job completed"));
  w.on("failed", (job, err) => logger.error({ worker: name, jobId: job?.id, err }, "job failed"));
}

logger.info("Render + compliance workers started");
