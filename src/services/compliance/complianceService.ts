import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { RenderManifestSchema } from "@/lib/schemas/render";
import { CampaignRulesSchema, type CampaignRules, type CampaignPlatform } from "@/lib/schemas/campaign";
import { runDeterministicChecks, overallOutcome, type ComplianceContext, type Finding } from "./validators";
import { semanticReview } from "./semanticReview";

/**
 * Evaluate a rendered clip against the campaign rules and current campaign
 * state. Deterministic validators run first; a semantic Claude check covers
 * prohibited content. All findings are persisted (idempotently replacing any
 * prior results for the clip) with PASS / FAIL / REVIEW + reason.
 */
export async function evaluateCompliance(renderedClipId: string): Promise<{ outcome: Finding["outcome"] } | null> {
  const rendered = await prisma.renderedClip.findUnique({
    where: { id: renderedClipId },
    include: { candidate: { include: { sourceAsset: { include: { campaign: true } } } } },
  });
  if (!rendered) {
    logger.warn({ renderedClipId }, "evaluateCompliance: rendered clip not found");
    return null;
  }
  const campaign = rendered.candidate.sourceAsset.campaign;

  const ruleRow = await prisma.campaignRule.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: "desc" },
  });
  const rules = ruleRow ? safeRules(ruleRow.rules) : null;
  if (!rules) throw new Error("Cannot evaluate compliance: campaign has no parsed rules");

  const manifest = RenderManifestSchema.safeParse(rendered.renderManifest);
  const captions = manifest.success ? manifest.data.captions : {};
  const overlaysApplied = manifest.success ? manifest.data.overlaysApplied : [];

  const [publicationCount, duplicate] = await Promise.all([
    prisma.publication.count({
      where: { renderedClip: { candidate: { sourceAsset: { campaignId: campaign.id } } } },
    }),
    hasDuplicate(rendered.candidateId, renderedClipId),
  ]);

  const targetPlatforms = (Object.keys(captions) as CampaignPlatform[]).length
    ? (Object.keys(captions) as CampaignPlatform[])
    : rules.supportedPlatforms;

  const ctx: ComplianceContext = {
    rules,
    campaignStatus: campaign.status,
    durationSec: rendered.durationSec,
    width: rendered.width,
    height: rendered.height,
    videoCodec: rendered.videoCodec,
    audioCodec: rendered.audioCodec,
    container: manifest.success ? manifest.data.container : null,
    overlaysApplied,
    captions: captions as Record<string, string>,
    originalSource: rendered.candidate.sourceAsset.originalSource,
    publicationCount,
    duplicate,
    targetPlatforms,
    now: new Date(),
  };

  const findings: Finding[] = runDeterministicChecks(ctx);
  findings.push(
    await semanticReview(rules, captions as Record<string, string>, overlaysApplied.map((o) => o.value)),
  );

  // Idempotent: replace prior results for this clip.
  await prisma.complianceResult.deleteMany({ where: { renderedClipId } });
  await prisma.complianceResult.createMany({
    data: findings.map((x) => ({
      renderedClipId,
      ruleId: ruleRow?.id,
      check: x.check,
      outcome: x.outcome,
      reason: x.reason,
      deterministic: x.deterministic,
    })),
  });

  const outcome = overallOutcome(findings);
  await audit({
    action: "clip.compliance.evaluated",
    entityType: "RenderedClip",
    entityId: renderedClipId,
    metadata: { outcome, fail: findings.filter((x) => x.outcome === "FAIL").length },
  });
  logger.info({ renderedClipId, outcome }, "Compliance evaluated");
  return { outcome };
}

function safeRules(value: unknown): CampaignRules | null {
  const parsed = CampaignRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Duplicate if another rendered clip of the same candidate already has a publication. */
async function hasDuplicate(candidateId: string, renderedClipId: string): Promise<boolean> {
  const count = await prisma.publication.count({
    where: {
      renderedClip: { candidateId, id: { not: renderedClipId } },
    },
  });
  return count > 0;
}
