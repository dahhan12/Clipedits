import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { RenderManifestSchema } from "@/lib/schemas/render";
import { CampaignRulesSchema, type CampaignRules, type CampaignPlatform } from "@/lib/schemas/campaign";
import { runDeterministicChecks, overallOutcome, type ComplianceContext, type Finding } from "./validators";
import { semanticReview } from "./semanticReview";
import { checkPermission } from "@/services/rights/permissionService";
import { normalizedDistance, isNearDuplicate } from "@/lib/media/perceptualHash";
import type { Platform, TransformationType } from "@/generated/prisma";

/** Video-distance threshold (≤10% of bits differ) for a perceptual near-duplicate. */
const PERCEPTUAL_MAX_RATIO = 0.1;
/** Audio fingerprints within 15% count as a match (looser: coarser fingerprint). */
const AUDIO_MAX_RATIO = 0.15;

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

  // Rights/provenance: worst-case across target platforms for the applied
  // transformations. Unverified/absent permission → REVIEW (never PASS).
  const appliedTransforms = permissionTransforms(overlaysApplied, captions as Record<string, string>);
  const sourcePermission = await worstPermission(
    rendered.candidate.sourceAsset.id,
    appliedTransforms,
    (Object.keys(captions) as CampaignPlatform[]).length ? (Object.keys(captions) as CampaignPlatform[]) : rules.supportedPlatforms,
  );

  const captionValues = Object.values(captions as Record<string, string>).filter(Boolean);
  const [publicationCount, duplicate, duplicateCaption, perceptualDuplicate, publicVerified] = await Promise.all([
    prisma.publication.count({
      where: { renderedClip: { candidate: { sourceAsset: { campaignId: campaign.id } } } },
    }),
    hasDuplicate(rendered.candidateId, renderedClipId),
    hasDuplicateCaption(campaign.id, renderedClipId, captionValues),
    findPerceptualDuplicate(campaign.id, renderedClipId, rendered.perceptualHash, rendered.audioHash),
    latestPublicVerified(renderedClipId),
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
    bytes: rendered.bytes,
    overlaysApplied,
    captions: captions as Record<string, string>,
    originalSource: rendered.candidate.sourceAsset.originalSource,
    sourcePermission,
    publicationCount,
    duplicate,
    duplicateCaption,
    perceptualDuplicate,
    publicVerified,
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

/** Transformations to rights-check, based on what the render actually applied. */
function permissionTransforms(
  overlays: { kind: string }[],
  captions: Record<string, string>,
): TransformationType[] {
  const t: TransformationType[] = ["DOWNLOAD", "CLIP", "MODIFY", "PUBLISH"];
  if (Object.values(captions).some(Boolean)) t.push("CAPTION");
  if (overlays.length > 0) t.push("OVERLAY");
  return t;
}

/** Combine per-platform permission checks into the strictest outcome. */
async function worstPermission(
  sourceAssetId: string,
  transforms: TransformationType[],
  platforms: CampaignPlatform[],
): Promise<{ outcome: "PASS" | "FAIL" | "REVIEW"; reason: string }> {
  const targets = platforms
    .map((p) => (p === "TIKTOK" || p === "INSTAGRAM_REELS" || p === "YOUTUBE_SHORTS" ? (p as Platform) : null))
    .filter((p): p is Platform => p !== null);
  if (targets.length === 0) {
    const c = await checkPermission(sourceAssetId, transforms);
    return { outcome: c.outcome, reason: c.reason };
  }
  let worst: { outcome: "PASS" | "FAIL" | "REVIEW"; reason: string } = { outcome: "PASS", reason: "All platforms permitted" };
  const rank = { PASS: 0, REVIEW: 1, FAIL: 2 } as const;
  for (const platform of targets) {
    const c = await checkPermission(sourceAssetId, transforms, platform);
    if (rank[c.outcome] > rank[worst.outcome]) worst = { outcome: c.outcome, reason: `${platform}: ${c.reason}` };
  }
  return worst;
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

/** True if any of these captions was already used by another publication in the campaign. */
async function hasDuplicateCaption(
  campaignId: string,
  renderedClipId: string,
  captions: string[],
): Promise<boolean> {
  if (captions.length === 0) return false;
  const count = await prisma.publication.count({
    where: {
      renderedClipId: { not: renderedClipId },
      captionText: { in: captions },
      renderedClip: { candidate: { sourceAsset: { campaignId } } },
    },
  });
  return count > 0;
}

/**
 * Perceptual/audio near-duplicate detection: compare this clip's fingerprints
 * against every OTHER already-published rendered clip in the same campaign. This
 * catches re-encodes / minor edits of content already posted — which the exact
 * `renderConfigHash` idempotency key and the same-candidate `hasDuplicate` check
 * cannot see. Returns the closest match within threshold, or null.
 */
async function findPerceptualDuplicate(
  campaignId: string,
  renderedClipId: string,
  perceptualHash: string | null,
  audioHash: string | null,
): Promise<{ renderedClipId: string; videoDistance: number; audioMatch: boolean } | null> {
  if (!perceptualHash) return null; // nothing to compare (ffmpeg absent at render time)
  const others = await prisma.renderedClip.findMany({
    where: {
      id: { not: renderedClipId },
      perceptualHash: { not: null },
      candidate: { sourceAsset: { campaignId } },
      publications: { some: {} }, // only already-published clips
    },
    select: { id: true, perceptualHash: true, audioHash: true },
  });
  let best: { renderedClipId: string; videoDistance: number; audioMatch: boolean } | null = null;
  for (const o of others) {
    if (!o.perceptualHash) continue;
    const videoDistance = normalizedDistance(perceptualHash, o.perceptualHash);
    if (videoDistance > PERCEPTUAL_MAX_RATIO) continue;
    const audioMatch = isNearDuplicate(audioHash, o.audioHash, AUDIO_MAX_RATIO);
    if (!best || videoDistance < best.videoDistance) {
      best = { renderedClipId: o.id, videoDistance, audioMatch };
    }
  }
  return best;
}

/** Most recent public-verification state across this clip's publications, if any. */
async function latestPublicVerified(renderedClipId: string): Promise<boolean | null> {
  const pub = await prisma.publication.findFirst({
    where: { renderedClipId, postUrl: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { publicVerified: true },
  });
  return pub ? pub.publicVerified : null;
}
