import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { dispatchJob } from "@/lib/queue/dispatch";
import { isRetryableCategory, type FailureCategory } from "@/lib/observability/failureCategory";

/**
 * Dead-letter operations. A dead letter is a JobRun parked at DEAD_LETTER after
 * its retries were exhausted (see deadLetter.ts). Replay resets the run so the
 * idempotency guard permits a fresh attempt and re-enqueues it via the shared
 * dispatcher.
 *
 * Safety: replay of a *non-retryable* category (RIGHTS_DENIED, MEDIA_INVALID,
 * PROVIDER_REJECTED, CONFIG_MISSING, NOT_FOUND, UNKNOWN) is refused unless the
 * caller explicitly passes `force` — those failures will simply recur until the
 * underlying cause (rights, media, credentials, code) is fixed, so a blind
 * replay just burns quota and hides the real problem.
 */

export interface DeadLetter {
  id: string;
  queue: string;
  jobKey: string;
  failureCategory: string | null;
  error: string | null;
  attempts: number;
  deadLetteredAt: Date | null;
  retryable: boolean;
}

export async function listDeadLetters(limit = 100): Promise<DeadLetter[]> {
  try {
    const rows = await prisma.jobRun.findMany({
      where: { status: "DEAD_LETTER" },
      orderBy: { deadLetteredAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      queue: r.queue,
      jobKey: r.jobKey,
      failureCategory: r.failureCategory,
      error: r.error,
      attempts: r.attempts,
      deadLetteredAt: r.deadLetteredAt,
      retryable: r.failureCategory ? isRetryableCategory(r.failureCategory as FailureCategory) : false,
    }));
  } catch (err) {
    logger.error({ err }, "listDeadLetters failed");
    return [];
  }
}

export type ReplayResult =
  | { ok: true; requeued: true }
  | { ok: false; reason: "not_found" | "not_dead_letter" | "not_retryable" | "dispatch_failed" };

export async function replayDeadLetter(
  queue: string,
  jobKey: string,
  opts: {
    force?: boolean;
    actor?: string;
    /** Injectable for tests; defaults to the shared queue dispatcher. */
    dispatch?: (queue: string, jobKey: string) => Promise<void>;
  } = {},
): Promise<ReplayResult> {
  const dispatch = opts.dispatch ?? dispatchJob;
  const run = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
  if (!run) return { ok: false, reason: "not_found" };
  if (run.status !== "DEAD_LETTER") return { ok: false, reason: "not_dead_letter" };

  const retryable = run.failureCategory
    ? isRetryableCategory(run.failureCategory as FailureCategory)
    : false;
  if (!retryable && !opts.force) return { ok: false, reason: "not_retryable" };

  try {
    // Reset the run so withJobRun does not skip it as already-terminal, then
    // re-enqueue through the same idempotent path the pipeline uses.
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "QUEUED", error: null, failureCategory: null, deadLetteredAt: null },
    });
    await dispatch(queue, jobKey);
    await audit({
      action: opts.force ? "job.replay.forced" : "job.replay",
      entityType: "JobRun",
      entityId: run.id,
      actor: opts.actor,
      metadata: { queue, jobKey, priorCategory: run.failureCategory, force: opts.force ?? false },
    });
    logger.info({ queue, jobKey, force: opts.force ?? false }, "dead letter replayed");
    return { ok: true, requeued: true };
  } catch (err) {
    logger.error({ err, queue, jobKey }, "replayDeadLetter dispatch failed");
    // Restore the dead-letter state so the entry is not lost.
    await prisma.jobRun
      .update({
        where: { id: run.id },
        data: {
          status: "DEAD_LETTER",
          error: run.error,
          failureCategory: run.failureCategory,
          deadLetteredAt: run.deadLetteredAt,
        },
      })
      .catch(() => undefined);
    return { ok: false, reason: "dispatch_failed" };
  }
}
