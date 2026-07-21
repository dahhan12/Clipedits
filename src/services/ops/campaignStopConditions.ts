import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { transition } from "@/lib/db/guardedTransition";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";

/**
 * Campaign-level stop conditions. After a publish, a campaign that has hit its
 * post cap, exhausted its budget, or passed its deadline should be PAUSED so the
 * pipeline stops producing/publishing for it — rather than relying on per-clip
 * compliance to FAIL every future attempt. Pausing is guarded (only from PARSED
 * or ACTIVE) and audited.
 */

export interface StopConditionInput {
  status: string;
  publicationCount: number;
  maxPosts: number | null;
  budgetRemaining: number | null;
  deadline: string | null;
  now: Date;
}

export interface StopEvaluation {
  shouldPause: boolean;
  reasons: string[];
}

/** Pure evaluation of whether a campaign should now be paused. */
export function evaluateStopConditions(i: StopConditionInput): StopEvaluation {
  const reasons: string[] = [];
  if (i.maxPosts != null && i.publicationCount >= i.maxPosts) {
    reasons.push(`Post cap reached (${i.publicationCount}/${i.maxPosts})`);
  }
  if (i.budgetRemaining != null && i.budgetRemaining <= 0) {
    reasons.push("Campaign budget exhausted");
  }
  if (i.deadline) {
    const dl = new Date(i.deadline);
    if (!Number.isNaN(dl.getTime()) && dl.getTime() < i.now.getTime()) {
      reasons.push(`Deadline passed (${i.deadline})`);
    }
  }
  return { shouldPause: reasons.length > 0, reasons };
}

/** Only these states can be auto-paused by a stop condition. */
const PAUSABLE = new Set(["PARSED", "ACTIVE"]);

/**
 * Evaluate + apply stop conditions for a campaign. Returns the evaluation (with
 * `shouldPause`), and pauses the campaign when applicable. Never throws — a
 * failure here must not fail the publish that triggered it.
 */
export async function applyCampaignStopConditions(campaignId: string): Promise<StopEvaluation> {
  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return { shouldPause: false, reasons: [] };

    const ruleRow = await prisma.campaignRule.findFirst({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    });
    const parsed = ruleRow ? CampaignRulesSchema.safeParse(ruleRow.rules) : null;
    const rules = parsed?.success ? parsed.data : null;

    const publicationCount = await prisma.publication.count({
      where: {
        status: { in: ["PUBLISHED", "DRAFTED"] },
        renderedClip: { candidate: { sourceAsset: { campaignId } } },
      },
    });

    const evalResult = evaluateStopConditions({
      status: campaign.status,
      publicationCount,
      maxPosts: rules?.maxPosts ?? null,
      budgetRemaining: rules?.budgetRemaining ?? null,
      deadline: rules?.deadline ?? null,
      now: new Date(),
    });

    if (evalResult.shouldPause && PAUSABLE.has(campaign.status)) {
      await transition.campaign(campaignId, "PAUSED").catch((err) => {
        logger.warn({ err, campaignId }, "stop-condition pause transition failed");
      });
      await audit({
        action: "campaign.autopaused",
        entityType: "Campaign",
        entityId: campaignId,
        metadata: { reasons: evalResult.reasons, publicationCount },
      });
      logger.warn({ campaignId, reasons: evalResult.reasons }, "campaign auto-paused by stop conditions");
    }
    return evalResult;
  } catch (err) {
    logger.warn({ err, campaignId }, "applyCampaignStopConditions failed");
    return { shouldPause: false, reasons: [] };
  }
}
