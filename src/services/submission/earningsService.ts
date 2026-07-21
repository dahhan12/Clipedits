import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { estimateEarnings } from "./trackingService";
import { ContentRewardsStatusAdapter, type SubmissionStatusAdapter } from "@/adapters/submission/statusAdapter";
import type { PayoutStatus } from "@/generated/prisma";

/**
 * Recompute a submission's earnings and payout state and write an
 * EarningsRecord snapshot. Qualified views come from the latest PostMetric;
 * estimated earnings are derived deterministically from campaign CPM; confirmed
 * earnings / approval / payout status come from the campaign portal (unknown in
 * sandbox — never fabricated).
 */
export async function syncEarnings(
  submissionId: string,
  statusAdapter: SubmissionStatusAdapter = new ContentRewardsStatusAdapter(),
): Promise<void> {
  const submission = await prisma.campaignSubmission.findUnique({
    where: { id: submissionId },
    include: {
      publication: { include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } } },
      campaign: { include: { rules: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });
  if (!submission) {
    logger.warn({ submissionId }, "syncEarnings: submission not found");
    return;
  }

  const ruleRow = submission.campaign.rules[0];
  const parsed = ruleRow ? CampaignRulesSchema.safeParse(ruleRow.rules) : null;
  const rules = parsed?.success ? parsed.data : null;

  const latestMetric = submission.publication.metrics[0];
  const qualifiedViews = latestMetric?.qualifiedViews ?? submission.qualifiedViews ?? null;
  const estimatedEarnings =
    qualifiedViews != null && rules
      ? estimateEarnings(rules, submission.publication.platform, qualifiedViews)
      : submission.estimatedEarnings ?? null;

  const status = await statusAdapter.poll({
    campaignSourceUrl: submission.campaign.sourceUrl,
    postUrl: submission.publication.postUrl,
  });

  const confirmedEarnings = status.confirmedEarnings ?? submission.confirmedEarnings ?? null;
  const payoutStatus: PayoutStatus = status.payoutStatus ?? submission.payoutStatus;

  await prisma.earningsRecord.create({
    data: {
      submissionId,
      qualifiedViews: qualifiedViews ?? undefined,
      estimatedEarnings: estimatedEarnings ?? undefined,
      confirmedEarnings: confirmedEarnings ?? undefined,
      payoutStatus,
    },
  });

  await prisma.campaignSubmission.update({
    where: { id: submissionId },
    data: {
      qualifiedViews: qualifiedViews ?? undefined,
      estimatedEarnings: estimatedEarnings ?? undefined,
      confirmedEarnings: confirmedEarnings ?? undefined,
      payoutStatus,
      approvalState: status.approvalState ?? submission.approvalState ?? undefined,
      rejectionReason: status.rejectionReason ?? submission.rejectionReason ?? undefined,
      status: status.approvalState === "APPROVED" ? "APPROVED" : status.approvalState === "REJECTED" ? "REJECTED" : submission.status,
    },
  });

  await audit({
    action: "submission.earnings.synced",
    entityType: "CampaignSubmission",
    entityId: submissionId,
    metadata: { qualifiedViews, estimatedEarnings, confirmedEarnings, payoutStatus },
  });
  logger.info({ submissionId, qualifiedViews, estimatedEarnings }, "Earnings synced");
}
