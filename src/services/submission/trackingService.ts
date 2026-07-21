import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import type { CampaignRules, CampaignPlatform } from "@/lib/schemas/campaign";
import { enqueueMetricsSync } from "@/lib/queue/queues";
import { ContentRewardsStatusAdapter, type SubmissionStatusAdapter } from "@/adapters/submission/statusAdapter";
import type { Platform } from "@/generated/prisma";

/**
 * Track a submission: poll the campaign portal for approval/rejection/payout
 * status, then kick off a metrics sync (which in turn triggers an earnings
 * sync). Approval/payout data is unknown in sandbox — never fabricated.
 */
export async function trackSubmission(
  submissionId: string,
  statusAdapter: SubmissionStatusAdapter = new ContentRewardsStatusAdapter(),
): Promise<void> {
  const submission = await prisma.campaignSubmission.findUnique({
    where: { id: submissionId },
    include: { publication: true, campaign: true },
  });
  if (!submission) {
    logger.warn({ submissionId }, "trackSubmission: not found");
    return;
  }

  const status = await statusAdapter.poll({
    campaignSourceUrl: submission.campaign.sourceUrl,
    postUrl: submission.publication.postUrl,
  });

  if (status.approvalState || status.rejectionReason || status.payoutStatus) {
    await prisma.campaignSubmission.update({
      where: { id: submissionId },
      data: {
        approvalState: status.approvalState ?? undefined,
        rejectionReason: status.rejectionReason ?? undefined,
        payoutStatus: status.payoutStatus ?? undefined,
        status:
          status.approvalState === "APPROVED"
            ? "APPROVED"
            : status.approvalState === "REJECTED"
              ? "REJECTED"
              : submission.status,
      },
    });
  }

  await enqueueMetricsSync(submission.publicationId);
  await audit({
    action: "submission.tracked",
    entityType: "CampaignSubmission",
    entityId: submissionId,
    metadata: { approvalState: status.approvalState },
  });
  logger.info({ submissionId, approvalState: status.approvalState }, "Submission tracked");
}

export function estimateEarnings(rules: CampaignRules, platform: Platform, views: number): number | null {
  const key = platform as CampaignPlatform;
  const cpm = rules.cpmByPlatform[key];
  if (cpm == null) return null;
  let earnings = (cpm * views) / 1000;
  if (rules.minPayout != null) earnings = Math.max(earnings, rules.minPayout);
  if (rules.maxPayout != null) earnings = Math.min(earnings, rules.maxPayout);
  return Number(earnings.toFixed(2));
}
