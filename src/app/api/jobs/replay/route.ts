import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { can, currentRole } from "@/lib/security/rbac";
import { sessionFromCookieHeader } from "@/lib/security/session";
import { logger } from "@/lib/logging/logger";
import { replayDeadLetter } from "@/services/ops/replayService";

/**
 * Replay a dead-lettered job. Requires `job.retry` (OPERATOR/ADMIN). A
 * non-retryable failure category is refused unless `force=1` is supplied — the
 * UI surfaces this so the operator makes a deliberate choice. CSRF is enforced
 * globally (same-origin middleware).
 */
export async function POST(req: Request) {
  const hdrs = await headers();
  const role = currentRole(hdrs);
  if (!can(role, "job.retry")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const queue = url.searchParams.get("queue") ?? "";
  const jobKey = url.searchParams.get("jobKey") ?? "";
  const force = url.searchParams.get("force") === "1";
  if (!queue || !jobKey) return NextResponse.json({ error: "Missing queue/jobKey" }, { status: 400 });

  const actor = sessionFromCookieHeader(hdrs.get("cookie"))?.userId ?? "operator";
  const result = await replayDeadLetter(queue, jobKey, { force, actor });

  if (result.ok) return NextResponse.json({ ok: true });

  switch (result.reason) {
    case "not_found":
      return NextResponse.json({ error: "Dead letter not found" }, { status: 404 });
    case "not_dead_letter":
      return NextResponse.json({ error: "Job is not dead-lettered" }, { status: 409 });
    case "not_retryable":
      return NextResponse.json(
        { error: "Failure category is not auto-retryable; resubmit with force to override" },
        { status: 422 },
      );
    default:
      logger.error({ queue, jobKey }, "replay dispatch failed");
      return NextResponse.json({ error: "Could not replay (is Redis reachable?)" }, { status: 502 });
  }
}
