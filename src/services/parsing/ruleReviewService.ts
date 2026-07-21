import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { assertSafeUrl, UrlValidationError } from "@/lib/security/url";
import { CampaignRulesSchema, deriveRuleStatus, type CampaignRules } from "@/lib/schemas/campaign";
import type { ResourceKind } from "@/generated/prisma";

/**
 * Persist an operator's manual rule correction as a SEPARATE reviewed revision
 * (a new CampaignRule row), never overwriting the model's original extraction.
 * The submitted rules are re-validated with Zod before anything is stored.
 */
export async function saveReviewedRules(campaignId: string, rawRules: unknown): Promise<{ ruleId: string }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found");

  const rules: CampaignRules = CampaignRulesSchema.parse(rawRules);
  const status = deriveRuleStatus(rules);

  const rule = await prisma.campaignRule.create({
    data: {
      campaignId,
      status,
      rules,
      confidence: rules.confidence,
      uncertainties: rules.uncertainties,
      model: "manual-review",
    },
  });

  // Sync resource links from the reviewed rules (idempotent per url).
  for (const link of rules.resourceLinks) {
    let permitted = link.permittedForDownload;
    try {
      await assertSafeUrl(link.url, { skipDnsResolution: true });
    } catch (err) {
      if (err instanceof UrlValidationError) permitted = false;
    }
    await prisma.campaignResource.upsert({
      where: { campaignId_url: { campaignId, url: link.url } },
      create: { campaignId, url: link.url, kind: classifyResource(link.url), permitted, notes: link.label },
      update: { permitted, notes: link.label },
    });
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: status === "PARSED" ? "PARSED" : "NEEDS_MANUAL_REVIEW" },
  });

  await audit({
    action: "campaign.rules.reviewed",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { ruleId: rule.id, status },
  });
  logger.info({ campaignId, ruleId: rule.id, status }, "Reviewed rules saved as new revision");
  return { ruleId: rule.id };
}

function classifyResource(url: string): ResourceKind {
  const u = url.toLowerCase();
  if (/drive\.google\.com\/drive\/folders|\/folders\//.test(u)) return "GOOGLE_DRIVE_FOLDER";
  if (/drive\.google\.com|docs\.google\.com/.test(u)) return "GOOGLE_DRIVE_FILE";
  if (/dropbox\.com\/scl\/fo|\/sh\//.test(u)) return "DROPBOX_FOLDER";
  if (/dropbox\.com/.test(u)) return "DROPBOX_FILE";
  if (/youtube\.com|youtu\.be/.test(u)) return "YOUTUBE";
  if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(u)) return "DIRECT_VIDEO";
  if (/\.(pdf|docx?|txt)(\?|$)/.test(u)) return "DOCUMENT";
  return "OTHER";
}
