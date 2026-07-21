import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { can, currentRole } from "@/lib/security/rbac";
import { actorFromHeaders, assertClipAccess } from "@/lib/db/workspaceScope";
import { sessionFromCookieHeader } from "@/lib/security/session";
import { submitPrePublicationReview } from "@/services/publishing/prePublicationService";
import { logger } from "@/lib/logging/logger";

const BodySchema = z.object({
  platform: z.enum(["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"]),
  mode: z.enum(["AUTO", "DRAFT", "MANUAL"]).default("AUTO"),
  decision: z.enum(["APPROVED", "REJECTED"]),
  justification: z.string().min(3).max(2000),
  acknowledgedChecks: z.array(z.string()).default([]),
});

/**
 * Record an operator pre-publication decision (approve/override or reject) with a
 * mandatory justification. Approving an AUTO override enables auto-posting, so it
 * requires `publish.now` (ADMIN). The decision + acknowledged REVIEW checks are
 * persisted as an audit trail; an approval also enqueues the publish. CSRF is
 * enforced by the same-origin middleware.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const hdrs = await headers();
  const role = currentRole(hdrs);
  if (!can(role, "publish.now")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    await assertClipAccess(id, actorFromHeaders(hdrs));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const reviewerId = sessionFromCookieHeader(hdrs.get("cookie"))?.userId ?? "operator";
  const result = await submitPrePublicationReview({
    renderedClipId: id,
    platform: parsed.data.platform,
    mode: parsed.data.mode,
    decision: parsed.data.decision,
    justification: parsed.data.justification,
    acknowledgedChecks: parsed.data.acknowledgedChecks,
    reviewerId,
  });

  if (result.ok) return NextResponse.json({ ok: true, decision: result.decision, enqueued: result.enqueued });

  const status: Record<string, number> = {
    not_found: 404,
    empty_justification: 400,
    has_fail: 409,
    blocking_review: 409,
    incomplete_ack: 400,
    enqueue_failed: 502,
  };
  const messages: Record<string, string> = {
    not_found: "Rendered clip not found",
    empty_justification: "A justification is required",
    has_fail: "Cannot approve: a compliance check FAILed (not overridable)",
    blocking_review: "Cannot approve: a safety-critical check needs REVIEW (resolve at source, not here)",
    incomplete_ack: "Acknowledge every waivable REVIEW finding to approve",
    enqueue_failed: "Recorded, but publish enqueue failed (is Redis reachable?)",
  };
  logger.warn({ id, reason: result.reason }, "pre-publication review rejected");
  return NextResponse.json({ error: messages[result.reason] ?? "Review failed" }, { status: status[result.reason] ?? 400 });
}
