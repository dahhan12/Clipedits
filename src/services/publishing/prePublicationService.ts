import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { enqueuePublish } from "@/lib/queue/queues";
import type { Platform, PublicationMode, PrePublicationReview } from "@/generated/prisma";

/**
 * Operator pre-publication review + override.
 *
 * An APPROVED review is an audited operator decision that lets a clip publish at
 * AUTO despite REVIEW compliance findings the operator has manually verified.
 * Hard rules that this override can NEVER waive:
 *   - a FAIL finding blocks publishing outright (unchanged);
 *   - a REVIEW on a safety-critical check (rights/provenance, prohibited content,
 *     duplicate/near-duplicate) is NOT acknowledgeable here — it must be resolved
 *     at its source (verify rights, re-render), not waved through.
 */

/** Checks whose REVIEW state may never be waived via a pre-publication override. */
export const NON_OVERRIDABLE_CHECKS: ReadonlySet<string> = new Set([
  "sourcePermission",
  "sourceEligibility",
  "prohibitedWords",
  "prohibitedContent", // semantic review check name
  "duplicateContent",
  "duplicateCaption",
  "perceptualDuplicate",
]);

export interface ComplianceFinding {
  check: string;
  outcome: string; // "PASS" | "FAIL" | "REVIEW"
}

export interface Reviewability {
  hasFail: boolean;
  reviewChecks: string[];
  /** REVIEW checks that block override because they are safety-critical. */
  blockingChecks: string[];
  /** REVIEW checks an operator may acknowledge to enable AUTO. */
  waivableChecks: string[];
  /** True when an APPROVED override could legitimately enable AUTO. */
  canOverride: boolean;
}

/** Classify a clip's findings into what an override can and cannot touch. */
export function evaluateReviewability(findings: ComplianceFinding[]): Reviewability {
  const hasFail = findings.some((f) => f.outcome === "FAIL");
  const reviewChecks = findings.filter((f) => f.outcome === "REVIEW").map((f) => f.check);
  const blockingChecks = reviewChecks.filter((c) => NON_OVERRIDABLE_CHECKS.has(c));
  const waivableChecks = reviewChecks.filter((c) => !NON_OVERRIDABLE_CHECKS.has(c));
  return {
    hasFail,
    reviewChecks,
    blockingChecks,
    waivableChecks,
    // Override only makes sense when there is something to waive, nothing FAILs,
    // and no safety-critical REVIEW is present.
    canOverride: !hasFail && blockingChecks.length === 0 && waivableChecks.length > 0,
  };
}

export type SubmitReviewResult =
  | { ok: true; decision: "APPROVED" | "REJECTED"; reviewId: string; enqueued: boolean }
  | { ok: false; reason: "not_found" | "empty_justification" | "has_fail" | "blocking_review" | "incomplete_ack" | "enqueue_failed" };

export async function submitPrePublicationReview(input: {
  renderedClipId: string;
  platform: Platform;
  mode: PublicationMode;
  decision: "APPROVED" | "REJECTED";
  justification: string;
  acknowledgedChecks: string[];
  reviewerId: string;
}): Promise<SubmitReviewResult> {
  const justification = input.justification.trim();
  if (justification.length < 3) return { ok: false, reason: "empty_justification" };

  const clip = await prisma.renderedClip.findUnique({
    where: { id: input.renderedClipId },
    include: { compliance: true },
  });
  if (!clip) return { ok: false, reason: "not_found" };

  const reviewability = evaluateReviewability(clip.compliance.map((c) => ({ check: c.check, outcome: c.outcome })));

  // A REJECTED decision is always recordable (it just documents "do not publish").
  if (input.decision === "APPROVED") {
    if (reviewability.hasFail) return { ok: false, reason: "has_fail" };
    if (reviewability.blockingChecks.length > 0) return { ok: false, reason: "blocking_review" };
    // Every waivable REVIEW must be explicitly acknowledged.
    const ack = new Set(input.acknowledgedChecks);
    const missing = reviewability.waivableChecks.filter((c) => !ack.has(c));
    if (missing.length > 0) return { ok: false, reason: "incomplete_ack" };
  }

  const review = await prisma.prePublicationReview.create({
    data: {
      renderedClipId: input.renderedClipId,
      platform: input.platform,
      mode: input.mode,
      decision: input.decision,
      reviewerId: input.reviewerId,
      justification,
      acknowledgedChecks: input.decision === "APPROVED" ? reviewability.waivableChecks : [],
    },
  });

  await audit({
    action: input.decision === "APPROVED" ? "clip.review.approved" : "clip.review.rejected",
    entityType: "RenderedClip",
    entityId: input.renderedClipId,
    actor: input.reviewerId,
    metadata: {
      platform: input.platform,
      mode: input.mode,
      acknowledgedChecks: review.acknowledgedChecks,
      justification,
    },
  });

  let enqueued = false;
  if (input.decision === "APPROVED") {
    try {
      await prisma.jobRun
        .deleteMany({ where: { queue: "publish", jobKey: `publish:${input.renderedClipId}:${input.platform}:${input.mode}` } })
        .catch(() => undefined);
      await enqueuePublish({ renderedClipId: input.renderedClipId, platform: input.platform, mode: input.mode });
      enqueued = true;
    } catch (err) {
      logger.error({ err, renderedClipId: input.renderedClipId }, "review approved but publish enqueue failed");
      return { ok: false, reason: "enqueue_failed" };
    }
  }

  logger.info(
    { renderedClipId: input.renderedClipId, decision: input.decision, enqueued },
    "pre-publication review recorded",
  );
  return { ok: true, decision: input.decision, reviewId: review.id, enqueued };
}

/** Most recent APPROVED review for a clip+platform, if any. */
export async function latestApprovedReview(
  renderedClipId: string,
  platform: Platform,
): Promise<PrePublicationReview | null> {
  return prisma.prePublicationReview.findFirst({
    where: { renderedClipId, platform, decision: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Whether an approved review covers all CURRENT waivable REVIEW findings — i.e.
 * the acknowledged set is still a superset of the clip's waivable REVIEWs, and no
 * new FAIL or blocking REVIEW has appeared since the review. Used by publishClip
 * to decide if AUTO may proceed despite REVIEW.
 */
export function reviewCoversCurrentFindings(
  review: PrePublicationReview | null,
  findings: ComplianceFinding[],
): boolean {
  if (!review) return false;
  const r = evaluateReviewability(findings);
  if (r.hasFail || r.blockingChecks.length > 0) return false;
  const ack = new Set(review.acknowledgedChecks);
  return r.waivableChecks.every((c) => ack.has(c));
}
