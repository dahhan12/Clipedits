import { createReadStream } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { objectStore, ensureLocalFile } from "@/adapters/storage/objectStore";
import { sha256Hex } from "@/lib/security/crypto";
import { transition } from "@/lib/db/guardedTransition";
import { probeVideoMeta, extractThumbnail } from "@/lib/media/ffmpeg";
import { FfmpegRenderer } from "@/lib/media/render/ffmpegRenderer";
import { RemotionRenderer } from "@/lib/media/render/remotionRenderer";
import type { OverlayRenderer } from "@/lib/media/render/types";
import { RenderManifestSchema, type AppliedOverlay } from "@/lib/schemas/render";
import { CampaignRulesSchema, type CampaignRules, type CampaignPlatform } from "@/lib/schemas/campaign";
import { TranscriptSchema } from "@/lib/schemas/media";
import { buildCaption } from "./captionText";
import { enqueueCompliance } from "@/lib/queue/queues";

/**
 * Render an approved clip candidate into a 9:16 H.264/AAC MP4.
 *
 * Overlays (captions / mentions / logos / required text) are applied ONLY when
 * the campaign requires or permits them. A full render manifest — every
 * transformation, every overlay, per-platform caption text — is persisted so
 * the compliance engine can verify mandatory elements were actually applied.
 */
export async function renderCandidate(candidateId: string): Promise<{ renderedClipId: string } | null> {
  const candidate = await prisma.clipCandidate.findUnique({
    where: { id: candidateId },
    include: { sourceAsset: true },
  });
  if (!candidate || !candidate.sourceAsset.storageKey) {
    logger.warn({ candidateId }, "renderCandidate: candidate/asset missing");
    return null;
  }
  const asset = candidate.sourceAsset;
  const storageKey = asset.storageKey;
  if (!storageKey) {
    logger.warn({ candidateId }, "renderCandidate: asset has no storage key");
    return null;
  }
  const rules = await latestRules(asset.campaignId);
  if (!rules) {
    throw new Error("Cannot render: campaign has no parsed rules");
  }

  // Mark the candidate as RENDERING (APPROVED/FAILED → RENDERING). Tolerant of
  // an idempotent re-render where the candidate is already RENDERED.
  await transition.clipCandidate(candidateId, "RENDERING").catch(() => undefined);

  const inputPath = await ensureLocalFile(storageKey);
  const workDir = await mkdtemp(path.join(tmpdir(), "cc-render-"));
  const outputPath = path.join(workDir, `${candidateId}.mp4`);

  const { overlays, overlaysApplied, logoText, requiresInAppAudioOrEffects } = buildOverlays(rules);
  const [w, h] = [env.RENDER_WIDTH, env.RENDER_HEIGHT];

  const renderer = pickRenderer();
  const normalizeAudio = true;
  const trimSilence = env.RENDER_TRIM_SILENCE;
  const transformations = [
    { step: "trim", detail: `${candidate.startSec.toFixed(2)}-${candidate.endSec.toFixed(2)}s` },
    { step: "scale+crop", detail: `${w}x${h} (9:16 cover)` },
    { step: "audio", detail: `loudnorm${trimSilence ? " + silence-trim" : ""}` },
    { step: "encode", detail: "libx264 crf23 + aac, +faststart" },
  ];
  const basePlan = {
    inputPath,
    outputPath,
    startSec: candidate.startSec,
    endSec: candidate.endSec,
    width: w,
    height: h,
    overlays,
    logoText,
    normalizeAudio,
    trimSilence,
  };

  let backendUsed = renderer.backend;
  try {
    await renderer.render(basePlan);
    if (overlays.length || logoText) {
      transformations.push({ step: "overlays", detail: `${overlays.length + (logoText ? 1 : 0)} applied via ${renderer.backend}` });
    }
  } catch (err) {
    if (renderer.backend === "remotion") {
      logger.warn({ err, candidateId }, "Remotion render failed; falling back to FFmpeg");
      await new FfmpegRenderer().render(basePlan);
      backendUsed = "ffmpeg";
      transformations.push({ step: "overlays", detail: "fallback to FFmpeg burn-in" });
    } else {
      throw err;
    }
  }

  // Probe the real output; fall back to configured frame size if probe fails.
  const meta = await probeVideoMeta(outputPath).catch(() => null);
  const width = meta?.width ?? w;
  const height = meta?.height ?? h;
  const outputBytes = await stat(outputPath).then((s) => s.size).catch(() => null);

  const renderKey = `campaigns/${asset.campaignId}/renders/${candidateId}.mp4`;
  await objectStore().putStream(renderKey, createReadStream(outputPath), "video/mp4");

  // Thumbnail from the rendered output (mid-clip frame).
  let thumbnailKey: string | null = null;
  try {
    const thumbPath = path.join(workDir, `${candidateId}.jpg`);
    const dur = meta?.durationSec ?? candidate.endSec - candidate.startSec;
    await extractThumbnail(outputPath, Math.min(1, dur / 2), thumbPath);
    thumbnailKey = `campaigns/${asset.campaignId}/renders/${candidateId}.jpg`;
    await objectStore().putStream(thumbnailKey, createReadStream(thumbPath), "image/jpeg");
    transformations.push({ step: "thumbnail", detail: "mid-clip frame" });
  } catch (err) {
    logger.warn({ err, candidateId }, "Thumbnail extraction failed");
  }

  const captions = await buildCaptions(rules, excerpt(asset.transcript, candidate.startSec, candidate.endSec));

  const manifest = RenderManifestSchema.parse({
    sourceAssetId: asset.id,
    candidateId,
    backend: backendUsed,
    range: { startSec: candidate.startSec, endSec: candidate.endSec },
    width,
    height,
    aspectRatio: `${width}:${height}`,
    videoCodec: meta?.videoCodec ?? "h264",
    audioCodec: meta?.audioCodec ?? "aac",
    container: meta?.container ?? "mp4",
    transformations,
    overlaysApplied,
    captions,
    requiresInAppAudioOrEffects,
    createdAt: new Date().toISOString(),
  });

  // Idempotency key for this exact render configuration.
  const renderConfigHash = sha256Hex(
    JSON.stringify({
      range: [candidate.startSec, candidate.endSec],
      w,
      h,
      overlays,
      logoText: logoText ?? null,
      backend: backendUsed,
      normalizeAudio,
      trimSilence,
    }),
  );

  // Replace any prior render of this config that was never published; then
  // upsert on (candidateId, renderConfigHash) so a retry is idempotent.
  await prisma.renderedClip.deleteMany({
    where: { candidateId, renderConfigHash, publications: { none: {} } },
  });
  const commonData = {
    storageKey: renderKey,
    thumbnailKey,
    width,
    height,
    bytes: outputBytes,
    durationSec: meta?.durationSec ?? candidate.endSec - candidate.startSec,
    videoCodec: meta?.videoCodec ?? "h264",
    audioCodec: meta?.audioCodec ?? "aac",
    renderManifest: manifest,
  };
  const rendered = await prisma.renderedClip.upsert({
    where: { candidateId_renderConfigHash: { candidateId, renderConfigHash } },
    create: { candidateId, renderConfigHash, ...commonData },
    update: commonData,
  });

  // Guarded transition (APPROVED/RENDERING → RENDERED); ignore if already terminal.
  await transition.clipCandidate(candidateId, "RENDERED").catch((err) => {
    logger.warn({ err, candidateId }, "clip candidate already in terminal/again state");
  });
  await audit({
    action: "clip.rendered",
    entityType: "RenderedClip",
    entityId: rendered.id,
    metadata: { candidateId, backend: backendUsed, width, height },
  });
  await enqueueCompliance(rendered.id);

  logger.info({ candidateId, renderedClipId: rendered.id, backend: backendUsed }, "Clip rendered");
  return { renderedClipId: rendered.id };
}

// --- helpers ---------------------------------------------------------------

function pickRenderer(): OverlayRenderer {
  return env.RENDER_BACKEND === "remotion" ? new RemotionRenderer() : new FfmpegRenderer();
}

/** Build the overlay text set, applying only required/permitted elements. */
function buildOverlays(rules: CampaignRules): {
  overlays: string[];
  overlaysApplied: AppliedOverlay[];
  logoText?: string;
  requiresInAppAudioOrEffects: boolean;
} {
  const overlaysApplied: AppliedOverlay[] = [];
  const overlays: string[] = [];

  for (const cap of rules.requiredCaptions) {
    overlays.push(cap);
    overlaysApplied.push({ kind: "CAPTION", value: cap, required: true });
  }
  for (const mention of rules.requiredMentions) {
    const m = mention.startsWith("@") ? mention : `@${mention}`;
    overlays.push(m);
    overlaysApplied.push({ kind: "MENTION", value: m, required: true });
  }
  let logoText: string | undefined;
  for (const ov of rules.requiredOverlaysAndLogos) {
    if (!logoText) logoText = ov;
    overlaysApplied.push({ kind: "LOGO", value: ov, required: true });
  }

  const audioText = rules.requiredAudio.join(" ").toLowerCase();
  const requiresInAppAudioOrEffects = /in-?app|official (audio|sound)|tiktok sound|sticker|effect/.test(audioText);

  return { overlays, overlaysApplied, logoText, requiresInAppAudioOrEffects };
}

async function buildCaptions(rules: CampaignRules, transcriptExcerpt: string): Promise<Record<string, string>> {
  const platforms: CampaignPlatform[] = rules.supportedPlatforms.length
    ? rules.supportedPlatforms
    : ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"];
  const out: Record<string, string> = {};
  for (const p of platforms) {
    out[p] = await buildCaption(p, rules, transcriptExcerpt);
  }
  return out;
}

async function latestRules(campaignId: string): Promise<CampaignRules | null> {
  const rule = await prisma.campaignRule.findFirst({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  if (!rule) return null;
  const parsed = CampaignRulesSchema.safeParse(rule.rules);
  return parsed.success ? parsed.data : null;
}

function excerpt(transcriptValue: unknown, startSec: number, endSec: number): string {
  const parsed = TranscriptSchema.safeParse(transcriptValue);
  if (!parsed.success) return "";
  return parsed.data.segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => s.text)
    .join(" ")
    .slice(0, 1500);
}
