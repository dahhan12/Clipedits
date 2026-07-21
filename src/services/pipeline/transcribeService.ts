import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { ensureLocalFile } from "@/adapters/storage/objectStore";
import { probeDurationSec, FfmpegUnavailable } from "@/lib/media/ffmpeg";
import { SandboxTranscriber } from "@/adapters/transcription/sandbox";
import type { Transcriber } from "@/adapters/transcription/types";
import { enqueueClip } from "@/lib/queue/queues";

/**
 * Produce a timestamped transcript for a source asset and persist it. Duration
 * is probed with ffprobe when available; otherwise the asset's existing
 * duration is used. On success, a clip-generation job is enqueued.
 */
export async function transcribeAsset(
  assetId: string,
  transcriber: Transcriber = new SandboxTranscriber(),
): Promise<void> {
  const asset = await prisma.sourceAsset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.storageKey) {
    logger.warn({ assetId }, "transcribeAsset: asset or storageKey missing");
    return;
  }

  let durationSec = asset.durationSec ?? null;
  let path: string | null = null;
  try {
    path = await ensureLocalFile(asset.storageKey);
    durationSec = await probeDurationSec(path);
  } catch (err) {
    if (!(err instanceof FfmpegUnavailable)) logger.warn({ err, assetId }, "Duration probe failed");
    durationSec = durationSec ?? 60; // conservative default so segmentation still runs
  }

  const transcript = await transcriber.transcribe({ path: path ?? "", durationSec });

  await prisma.sourceAsset.update({
    where: { id: assetId },
    data: { durationSec, transcript, status: "READY" },
  });

  await audit({
    action: "asset.transcribed",
    entityType: "SourceAsset",
    entityId: assetId,
    metadata: { provider: transcript.provider, segments: transcript.segments.length },
  });

  await enqueueClip(assetId);
  logger.info({ assetId, segments: transcript.segments.length }, "Asset transcribed");
}
