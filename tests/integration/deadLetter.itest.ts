import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { handleTerminalFailure } from "@/workers/deadLetter";
import { listDeadLetters, replayDeadLetter } from "@/services/ops/replayService";
import type { Job } from "bullmq";

/**
 * Dead-letter capture + safe replay. Exercises the terminal-failure path
 * (retries exhausted → DEAD_LETTER with a classified category), the retryable
 * gating on replay, and the reset-and-requeue with an injected dispatcher (so
 * no Redis is required). Self-skips without DATABASE_URL.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const keys: Array<{ queue: string; jobKey: string }> = [];

/** Minimal BullMQ Job stand-in with just the fields the handler reads. */
function fakeJob(queue: string, jobKey: string, attemptsMade: number, maxAttempts: number): Job {
  return {
    id: jobKey.replace(/:/g, "__"),
    name: queue,
    attemptsMade,
    opts: { attempts: maxAttempts },
  } as unknown as Job;
}

async function seedRunning(queue: string, jobKey: string) {
  keys.push({ queue, jobKey });
  await prisma.jobRun.upsert({
    where: { queue_jobKey: { queue, jobKey } },
    create: { queue, jobKey, status: "RUNNING", attempts: 3 },
    update: { status: "RUNNING", attempts: 3, failureCategory: null, deadLetteredAt: null, error: null },
  });
}

d("dead-letter capture + replay", () => {
  afterAll(async () => {
    for (const k of keys) {
      await prisma.jobRun.deleteMany({ where: { queue: k.queue, jobKey: k.jobKey } }).catch(() => undefined);
    }
    await prisma.auditEvent.deleteMany({ where: { action: { startsWith: "job.replay" } } }).catch(() => undefined);
  });

  it("does not dead-letter while retries remain", async () => {
    const queue = "render";
    const jobKey = `render:not-terminal-${Date.now()}`;
    await seedRunning(queue, jobKey);
    await handleTerminalFailure(queue, fakeJob(queue, jobKey, 1, 3), new Error("boom"));
    const run = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
    expect(run?.status).toBe("RUNNING");
  });

  it("dead-letters with a classified category once retries are exhausted", async () => {
    const queue = "render";
    const jobKey = `render:terminal-${Date.now()}`;
    await seedRunning(queue, jobKey);
    await handleTerminalFailure(queue, fakeJob(queue, jobKey, 3, 3), new Error("connect ECONNREFUSED 1.2.3.4:443"));
    const run = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
    expect(run?.status).toBe("DEAD_LETTER");
    expect(run?.failureCategory).toBe("TRANSIENT_NETWORK");
    expect(run?.deadLetteredAt).toBeTruthy();
  });

  it("lists dead letters with a retryable flag and gates non-retryable replay", async () => {
    const queue = "publish";
    const jobKey = `publish:rights-${Date.now()}:TIKTOK:AUTO`;
    await seedRunning(queue, jobKey);
    await handleTerminalFailure(queue, fakeJob(queue, jobKey, 3, 3), new Error("Render blocked — rights: DENIED"));

    const listed = await listDeadLetters(200);
    const mine = listed.find((x) => x.jobKey === jobKey);
    expect(mine?.failureCategory).toBe("RIGHTS_DENIED");
    expect(mine?.retryable).toBe(false);

    // Refused without force; JobRun stays dead-lettered.
    const refused = await replayDeadLetter(queue, jobKey, { dispatch: async () => undefined });
    expect(refused).toEqual({ ok: false, reason: "not_retryable" });
    const still = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
    expect(still?.status).toBe("DEAD_LETTER");
  });

  it("replays a retryable dead letter: resets the run and re-dispatches", async () => {
    const queue = "ingest";
    const jobKey = `ingest:replayme-${Date.now()}`;
    await seedRunning(queue, jobKey);
    await handleTerminalFailure(queue, fakeJob(queue, jobKey, 3, 3), new Error("429 too many requests"));

    let dispatched: string | null = null;
    const res = await replayDeadLetter(queue, jobKey, {
      dispatch: async (_q, k) => {
        dispatched = k;
      },
    });
    expect(res).toEqual({ ok: true, requeued: true });
    expect(dispatched).toBe(jobKey);
    const run = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
    expect(run?.status).toBe("QUEUED");
    expect(run?.failureCategory).toBeNull();
    expect(run?.deadLetteredAt).toBeNull();
  });

  it("forces replay of a non-retryable category when asked", async () => {
    const queue = "render";
    const jobKey = `render:force-${Date.now()}`;
    await seedRunning(queue, jobKey);
    await handleTerminalFailure(queue, fakeJob(queue, jobKey, 3, 3), new Error("corrupt input media"));

    const res = await replayDeadLetter(queue, jobKey, { force: true, dispatch: async () => undefined });
    expect(res).toEqual({ ok: true, requeued: true });
    const run = await prisma.jobRun.findUnique({ where: { queue_jobKey: { queue, jobKey } } });
    expect(run?.status).toBe("QUEUED");
  });

  it("returns not_found for an unknown dead letter", async () => {
    const res = await replayDeadLetter("render", "render:does-not-exist", { dispatch: async () => undefined });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
