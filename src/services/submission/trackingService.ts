import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { CampaignRulesSchema, type CampaignRules, type CampaignPlatform } from "@/lib/schemas/campaign";
import type { Platform } from "@/generated/prisma";

/**
 * Track a submission's performance: qualified views and estimated earnings.
 *
 * Qualified views come from the platform's analytics (sandbox returns null when
 * no analytics token is connected — we never invent numbers). Estimated
 * earnings are derived deterministically from the campaign's CPM for the
 * platform: earnings = cpm * qualifiedViews / 1000, clamped to the campaign's
 * min/max payout when specified.
 */
export async function trackSubmission(submissionId: string): Promise<void> {
  const submission = await prisma.campaignSubmission.findUnique({
    where: { id: submissionId },
    include: {
      publication: true,
      campaign: { include: { rules: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });
  if (!submission) {
    logger.warn({ submissionId }, "trackSubmission: not found");
    return;
  }

  const ruleRow = submission.campaign.rules[0];
  const rules = ruleRow ? safeRules(ruleRow.rules) : null;

  const qualifiedViews = await getQualifiedViews(submission.publication.platform, submission.publication.externalPostId);
  const estimatedEarnings =
    qualifiedViews != null && rules ? estimateEarnings(rules, submission.publication.platform, qualifiedViews) : null;

  await prisma.campaignSubmission.update({
    where: { id: submissionId },
    data: { qualifiedViews: qualifiedViews ?? undefined, estimatedEarnings: estimatedEarnings ?? undefined },
  });

  await audit({
    action: "submission.tracked",
    entityType: "CampaignSubmission",
    entityId: submissionId,
    metadata: { qualifiedViews, estimatedEarnings },
  });
  logger.info({ submissionId, qualifiedViews, estimatedEarnings }, "Submission tracked");
}

/**
 * Fetch qualified views from the platform's analytics API. Returns null when no
 * analytics access is configured (sandbox) — the caller records "unknown"
 * rather than fabricating a number.
 */
async function getQualifiedViews(_platform: Platform, _externalPostId: string | null): Promise<number | null> {
  // Real analytics integrations (TikTok/IG/YouTube insights) plug in here using
  // the connected account's token. Absent that, views are unknown.
  return null;
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

function safeRules(value: unknown): CampaignRules | null {
  const parsed = CampaignRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
