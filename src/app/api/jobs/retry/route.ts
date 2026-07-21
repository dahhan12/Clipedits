import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { dispatchJob } from "@/lib/queue/dispatch";

/**
 * Retry a failed job by re-enqueuing it from its (queue, jobKey). Clears the
 * prior JobRun so the idempotency guard allows the re-run. Requires
 * `job.retry` (OPERATOR/ADMIN).
 */
export async function POST(req: Request) {
  const role = currentRole(await headers());
  if (!can(role, "job.retry")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const queue = url.searchParams.get("queue") ?? "";
  const jobKey = url.searchParams.get("jobKey") ?? "";
  if (!queue || !jobKey) return NextResponse.json({ error: "Missing queue/jobKey" }, { status: 400 });

  try {
    await prisma.jobRun.deleteMany({ where: { queue, jobKey } }).catch(() => undefined);
    await dispatchJob(queue, jobKey);
    await audit({ action: "job.retry", entityType: "JobRun", role, metadata: { queue, jobKey } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, queue, jobKey }, "Failed to retry job");
    return NextResponse.json({ error: "Could not retry (is Redis reachable?)" }, { status: 502 });
  }
}
