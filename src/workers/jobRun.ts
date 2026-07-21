import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

/**
 * Wrap a unit of work in a JobRun record keyed on (queue, jobKey). If a
 * SUCCEEDED run already exists for the key, the work is skipped — this is the
 * backbone of "a campaign/post is never processed twice on retry".
 */
export async function withJobRun<T>(
  queue: string,
  jobKey: string,
  payload: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const existing = await prisma.jobRun.findUnique({
    where: { queue_jobKey: { queue, jobKey } },
  });
  if (existing?.status === "SUCCEEDED") {
    logger.info({ queue, jobKey }, "Skipping already-succeeded job");
    return undefined;
  }

  const run = await prisma.jobRun.upsert({
    where: { queue_jobKey: { queue, jobKey } },
    create: {
      queue,
      jobKey,
      status: "RUNNING",
      attempts: 1,
      payload: payload as object,
      startedAt: new Date(),
    },
    update: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), error: null },
  });

  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
    return result;
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
