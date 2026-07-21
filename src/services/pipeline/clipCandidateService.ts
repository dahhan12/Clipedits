import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { ensureLocalFile } from "@/adapters/storage/objectStore";
import { detectSceneBoundaries, FfmpegUnavailable } from "@/lib/media/ffmpeg";
import { TranscriptSchema, type Transcript } from "@/lib/schemas/media";
import { CampaignRulesSchema, type CampaignRules } from "@/lib/schemas/campaign";
import { buildCandidateRanges, type Range } from "./candidateRanges";
import { scoreClip } from "./clipScoring";

const DEFAULT_MIN = 15;
const DEFAULT_MAX = 60;
const ACCEPT_THRESHOLD = 0.45;
/** Bump when generation/scoring logic changes so re-runs produce a new candidate set. */
const SCORING_VERSION = 1;

export interface ClipGenSummary {
  candidates: number;
  rejected: number;
}

/**
 * Generate scored clip candidates for a source asset:
 *  1. scene detection (ffmpeg) → candidate ranges within the campaign's
 *     required duration window,
 *  2. reject ranges violating duration / source restrictions,
 *  3. Claude scoring for surviving ranges,
 *  4. persist ClipCandidate rows (regenerating idempotently, preserving any
 *     candidate that already has a rendered clip).
 */
export async function generateClipCandidates(assetId: string): Promise<ClipGenSummary> {
  const asset = await prisma.sourceAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    logger.warn({ assetId }, "generateClipCandidates: asset not found");
    return { candidates: 0, rejected: 0 };
  }

  const rules = await latestRules(asset.campaignId);
  const duration = asset.durationSec ?? transcriptDuration(asset.transcript) ?? 0;
  const target = durationTarget(rules);

  // Reject the whole asset up front if the source is disallowed by the campaign.
  const sourceViolation = sourceRestrictionViolation(asset.originalSource, rules);

  let boundaries: number[] = [];
  if (asset.storageKey) {
    try {
      boundaries = await detectSceneBoundaries(await ensureLocalFile(asset.storageKey));
    } catch (err) {
      if (!(err instanceof FfmpegUnavailable)) logger.warn({ err, assetId }, "Scene detection failed");
    }
  }

  const ranges = buildCandidateRanges(duration, boundaries, { min: target.min, max: target.max });
  const transcript = safeTranscript(asset.transcript);

  // Regenerate: drop prior candidates of THIS scoring version that were never
  // rendered. Candidates with a rendered clip, or from other scoring versions,
  // are preserved (and re-generation is idempotent via the unique key upsert).
  await prisma.clipCandidate.deleteMany({
    where: { sourceAssetId: assetId, scoringVersion: SCORING_VERSION, rendered: { none: {} } },
  });

  const summary: ClipGenSummary = { candidates: 0, rejected: 0 };

  for (const range of ranges) {
    const len = range.endSec - range.startSec;
    const durationViolation =
      len < target.min ? `below min ${target.min}s` : len > target.max ? `above max ${target.max}s` : null;
    const rejection = sourceViolation ?? durationViolation;

    const key = {
      sourceAssetId_startSec_endSec_scoringVersion: {
        sourceAssetId: assetId,
        startSec: range.startSec,
        endSec: range.endSec,
        scoringVersion: SCORING_VERSION,
      },
    };

    if (rejection) {
      await prisma.clipCandidate.upsert({
        where: key,
        create: {
          sourceAssetId: assetId,
          startSec: range.startSec,
          endSec: range.endSec,
          scoringVersion: SCORING_VERSION,
          status: "REJECTED",
          rejectionReason: rejection,
        },
        update: { status: "REJECTED", rejectionReason: rejection },
      });
      summary.rejected += 1;
      continue;
    }

    const scores = await scoreClip({
      campaignTitle: rules?.title ?? null,
      campaignContext: campaignContext(rules),
      transcriptExcerpt: excerptFor(transcript, range),
      positionRatio: duration > 0 ? range.startSec / duration : 0,
    });

    const belowBar = scores.overall < ACCEPT_THRESHOLD;
    await prisma.clipCandidate.upsert({
      where: key,
      create: {
        sourceAssetId: assetId,
        startSec: range.startSec,
        endSec: range.endSec,
        scoringVersion: SCORING_VERSION,
        status: belowBar ? "REJECTED" : "CANDIDATE",
        rejectionReason: belowBar ? `overall score ${scores.overall} below ${ACCEPT_THRESHOLD}` : null,
        scores,
      },
      update: {
        status: belowBar ? "REJECTED" : "CANDIDATE",
        rejectionReason: belowBar ? `overall score ${scores.overall} below ${ACCEPT_THRESHOLD}` : null,
        scores,
      },
    });
    if (belowBar) summary.rejected += 1;
    else summary.candidates += 1;
  }

  await audit({
    action: "asset.clips.generated",
    entityType: "SourceAsset",
    entityId: assetId,
    metadata: { ...summary, total: ranges.length },
  });
  logger.info({ assetId, ...summary }, "Clip candidates generated");
  return summary;
}

// --- helpers ---------------------------------------------------------------

async function latestRules(campaignId: string): Promise<CampaignRules | null> {
  const rule = await prisma.campaignRule.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });
  if (!rule) return null;
  const parsed = CampaignRulesSchema.safeParse(rule.rules);
  return parsed.success ? parsed.data : null;
}

function durationTarget(rules: CampaignRules | null): { min: number; max: number } {
  const req = rules?.requiredVideoDurationSec;
  const min = req?.min ?? DEFAULT_MIN;
  const max = req?.max ?? DEFAULT_MAX;
  return { min: Math.max(1, min), max: Math.max(min || DEFAULT_MIN, max) };
}

function sourceRestrictionViolation(source: string, rules: CampaignRules | null): string | null {
  if (!rules) return null;
  const s = source.toLowerCase();
  for (const restriction of rules.sourceContentRestrictions) {
    const r = restriction.toLowerCase();
    // Deterministic guard: if a restriction names a host/term present in the
    // source, flag it. Nuanced semantic checks belong to the compliance engine.
    if (r.includes("no youtube") && /youtube|youtu\.be/.test(s)) return `source restriction: ${restriction}`;
  }
  return null;
}

function campaignContext(rules: CampaignRules | null): string {
  if (!rules) return "No parsed rules available.";
  return [
    rules.supportedPlatforms.length ? `Platforms: ${rules.supportedPlatforms.join(", ")}` : "",
    rules.prohibitedContent.length ? `Prohibited: ${rules.prohibitedContent.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function safeTranscript(value: unknown): Transcript | null {
  const parsed = TranscriptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function transcriptDuration(value: unknown): number | null {
  return safeTranscript(value)?.durationSec ?? null;
}

function excerptFor(transcript: Transcript | null, range: Range): string {
  if (!transcript) return "(no transcript available)";
  const parts = transcript.segments
    .filter((s) => s.endSec > range.startSec && s.startSec < range.endSec)
    .map((s) => s.text);
  return parts.join(" ").slice(0, 2000) || "(no transcript in range)";
}
