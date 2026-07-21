import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { assertSafeUrl, UrlValidationError } from "@/lib/security/url";
import { deriveRuleStatus } from "@/lib/schemas/campaign";
import { transition } from "@/lib/db/guardedTransition";
import { parseCampaign } from "./campaignParser";
import type { ResourceKind } from "@/generated/prisma";

/**
 * Parse a campaign end-to-end and persist the validated results:
 *  - store the CampaignRule (validated JSON + confidence + uncertainties),
 *  - upsert every resource link (deduped on (campaignId, url)),
 *  - flip the campaign status to PARSED or NEEDS_MANUAL_REVIEW,
 *  - never persist unvalidated model output.
 */
export async function parseAndPersist(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    logger.warn({ campaignId }, "parseAndPersist: campaign not found");
    return;
  }

  await transition.campaign(campaignId, "PARSING");

  try {
    return await runParse(campaignId, campaign.externalId, campaign.sourceUrl, campaign.source);
  } catch (err) {
    await transition.campaign(campaignId, "ERROR").catch(() => undefined);
    throw err;
  }
}

async function runParse(
  campaignId: string,
  externalId: string,
  sourceUrl: string,
  source: string,
): Promise<void> {
  // Manual text entries store the pasted text on the latest revision snapshot;
  // use it directly instead of fetching a page.
  const snapshotRevision =
    source === "MANUAL"
      ? await prisma.campaignRevision.findFirst({
          where: { campaignId, rawSnapshot: { not: null } },
          orderBy: { capturedAt: "desc" },
        })
      : null;

  const { rules } = await parseCampaign({
    campaignId: externalId,
    sourceUrl,
    pageTextOverride: snapshotRevision?.rawSnapshot ?? undefined,
  });

  const ruleStatus = deriveRuleStatus(rules);

  await prisma.campaignRule.create({
    data: {
      campaignId,
      status: ruleStatus,
      rules,
      confidence: rules.confidence,
      uncertainties: rules.uncertainties,
      model: env.ANTHROPIC_MODEL,
    },
  });

  // Upsert resource links, classifying each and preserving the permitted flag.
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

  await transition.campaign(campaignId, ruleStatus === "PARSED" ? "PARSED" : "NEEDS_MANUAL_REVIEW");

  await audit({
    action: "campaign.parsed",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { status: ruleStatus, confidence: rules.confidence },
  });

  logger.info({ campaignId, ruleStatus }, "Campaign parse persisted");
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
