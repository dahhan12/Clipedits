import type { Job, Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { classifyFailure } from "@/lib/observability/failureCategory";

/**
 * Dead-letter capture. BullMQ retries a job up to `opts.attempts`; only once
 * those are exhausted is the failure terminal. At that point we classify it and
 * park the corresponding JobRun as DEAD_LETTER so operators can triage/replay it
 * (see replayService.ts). A non-terminal (will-retry) failure is left as FAILED
 * — withJobRun already recorded it, and the next attempt flips it back to
 * RUNNING.
 */

/** Recover the DB `jobKey` from a BullMQ job id (":" is encoded as "__"). */
function jobKeyFromId(job: Job): string {
  const id = job.id ?? "";
  return id ? id.replace(/__/g, ":") : job.name;
}

export async function handleTerminalFailure(queue: string, job: Job, err: unknown): Promise<void> {
  const maxAttempts = job.opts.attempts ?? 1;
  // attemptsMade is incremented before the failed event fires; the job will be
  // retried while attemptsMade < maxAttempts.
  if (job.attemptsMade < maxAttempts) return;

  const { category, message } = classifyFailure(err);
  const jobKey = jobKeyFromId(job);
  try {
    const res = await prisma.jobRun.updateMany({
      where: { queue, jobKey },
      data: {
        status: "DEAD_LETTER",
        failureCategory: category,
        deadLetteredAt: new Date(),
        error: `[${category}] ${message}`.slice(0, 2000),
      },
    });
    // No JobRun row (job never entered withJobRun) — still record the terminal
    // failure so it is not lost, keyed by (queue, jobKey).
    if (res.count === 0) {
      await prisma.jobRun.create({
        data: {
          queue,
          jobKey,
          status: "DEAD_LETTER",
          attempts: job.attemptsMade,
          failureCategory: category,
          deadLetteredAt: new Date(),
          error: `[${category}] ${message}`.slice(0, 2000),
        },
      });
    }
    await audit({
      action: "job.deadlettered",
      entityType: "JobRun",
      entityId: `${queue}:${jobKey}`,
      metadata: { queue, jobKey, category, attempts: job.attemptsMade },
    });
    logger.error({ queue, jobKey, category, attempts: job.attemptsMade }, "job dead-lettered");
  } catch (recordErr) {
    logger.error({ recordErr, queue, jobKey }, "failed to record dead letter");
  }
}

/**
 * Wire completed/failed logging + terminal-failure capture onto a set of
 * (queueName, worker) pairs. Replaces the ad-hoc per-worker event loops.
 */
export function attachWorkerObservability(pairs: readonly (readonly [string, Worker])[]): void {
  for (const [name, w] of pairs) {
    w.on("completed", (job) => logger.info({ worker: name, jobId: job.id }, "job completed"));
    w.on("failed", (job, err) => {
      logger.error({ worker: name, jobId: job?.id, err }, "job failed");
      if (job) void handleTerminalFailure(name, job, err);
    });
  }
}
