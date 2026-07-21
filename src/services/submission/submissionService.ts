import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { transition } from "@/lib/db/guardedTransition";
import { verifyPublicAccessible } from "./verifyPublic";
import { ContentRewardsSubmissionAdapter } from "@/adapters/submission/contentRewards";
import type { SubmissionAdapter } from "@/adapters/submission/types";
import { enqueueTracking } from "@/lib/queue/queues";

/**
 * Prepare a campaign submission for a publication:
 *  - record/verify the post URL is publicly accessible where possible,
 *  - upsert a CampaignSubmission idempotently on (campaignId, publicationId),
 *  - during the MVP, stop at AWAITING_CONFIRMATION so a human confirms before
 *    the final on-site submit; only then is the submission executed.
 */
export async function prepareSubmission(publicationId: string): Promise<{ status: string } | null> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    include: { renderedClip: { include: { candidate: { include: { sourceAsset: { include: { campaign: true } } } } } } },
  });
  if (!publication) {
    logger.warn({ publicationId }, "prepareSubmission: publication not found");
    return null;
  }
  const campaign = publication.renderedClip.candidate.sourceAsset.campaign;

  // Verify public accessibility of the post where we have a URL.
  if (publication.postUrl) {
    const ok = await verifyPublicAccessible(publication.postUrl);
    await prisma.publication.update({ where: { id: publicationId }, data: { publicVerified: ok } });
  }

  const hasPost = !!(publication.postUrl || publication.externalPostId);
  // A prepared submission requires an actual post to reference.
  const initialStatus = !hasPost
    ? "PREPARED"
    : env.SUBMISSION_REQUIRE_CONFIRMATION
      ? "AWAITING_CONFIRMATION"
      : "SUBMITTED";

  const submission = await prisma.campaignSubmission.upsert({
    where: { campaignId_publicationId: { campaignId: campaign.id, publicationId } },
    create: { campaignId: campaign.id, publicationId, status: initialStatus },
    update: { status: initialStatus },
  });

  await audit({
    action: "submission.prepared",
    entityType: "CampaignSubmission",
    entityId: submission.id,
    metadata: { status: initialStatus, hasPost },
  });

  // Auto-execute only when confirmation is not required and a post exists.
  if (initialStatus === "SUBMITTED") {
    await executeSubmission(submission.id);
  }

  logger.info({ submissionId: submission.id, status: initialStatus }, "Submission prepared");
  return { status: initialStatus };
}

/**
 * Execute the on-site submission (Playwright form-fill). Called after human
 * confirmation, or directly when confirmation is disabled. Idempotent: a
 * submission already SUBMITTED/APPROVED is not re-submitted.
 */
export async function executeSubmission(
  submissionId: string,
  adapter: SubmissionAdapter = new ContentRewardsSubmissionAdapter(),
): Promise<{ status: string }> {
  const submission = await prisma.campaignSubmission.findUnique({
    where: { id: submissionId },
    include: {
      campaign: true,
      publication: true,
    },
  });
  if (!submission) throw new Error("Submission not found");
  if (["SUBMITTED", "APPROVED"].includes(submission.status)) {
    return { status: submission.status };
  }
  const postUrl = submission.publication.postUrl;
  if (!postUrl) {
    return { status: submission.status };
  }

  try {
    const outcome = await adapter.submit({
      campaignSourceUrl: submission.campaign.sourceUrl,
      postUrl,
      platform: submission.publication.platform,
    });
    const status = outcome.submitted ? "SUBMITTED" : "PREPARED";
    if (outcome.submitted) {
      await transition.submission(submissionId, "SUBMITTED", { submittedAt: new Date() });
    }
    await audit({
      action: "submission.executed",
      entityType: "CampaignSubmission",
      entityId: submissionId,
      metadata: { submitted: outcome.submitted, official: adapter.official, note: outcome.note },
    });
    if (outcome.submitted) await enqueueTracking(submissionId);
    return { status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await transition
      .submission(submissionId, "FAILED", { rejectionReason: msg })
      .catch(() => undefined);
    logger.error({ err, submissionId }, "Submission execution failed");
    throw err;
  }
}

/** Confirm and execute a submission that was awaiting human sign-off. */
export async function confirmSubmission(submissionId: string): Promise<{ status: string }> {
  await audit({ action: "submission.confirmed", entityType: "CampaignSubmission", entityId: submissionId });
  return executeSubmission(submissionId);
}
