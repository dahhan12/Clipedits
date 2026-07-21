import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { ensureLocalFile } from "@/adapters/storage/objectStore";
import { probeDurationSec, extractAudioWav, FfmpegUnavailable } from "@/lib/media/ffmpeg";
import { SandboxTranscriber } from "@/adapters/transcription/sandbox";
import { WhisperTranscriber } from "@/adapters/transcription/whisper";
import type { Transcriber } from "@/adapters/transcription/types";
import { enqueueClip } from "@/lib/queue/queues";

/** Whisper when configured (word-level), else the deterministic sandbox. */
function pickTranscriber(): Transcriber {
  return isSandbox.whisper() ? new SandboxTranscriber() : new WhisperTranscriber();
}

/**
 * Produce a timestamped transcript for a source asset and persist it. Duration
 * is probed with ffprobe when available; otherwise the asset's existing
 * duration is used. On success, a clip-generation job is enqueued.
 */
export async function transcribeAsset(
  assetId: string,
  transcriber: Transcriber = pickTranscriber(),
): Promise<void> {
  const asset = await prisma.sourceAsset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.storageKey) {
    logger.warn({ assetId }, "transcribeAsset: asset or storageKey missing");
    return;
  }

  let durationSec = asset.durationSec ?? null;
  let videoPath: string | null = null;
  try {
    videoPath = await ensureLocalFile(asset.storageKey);
    durationSec = await probeDurationSec(videoPath);
  } catch (err) {
    if (!(err instanceof FfmpegUnavailable)) logger.warn({ err, assetId }, "Duration probe failed");
    durationSec = durationSec ?? 60; // conservative default so segmentation still runs
  }

  // Real ASR needs an audio file; extract a WAV when a live backend is used.
  const workDir = await mkdtemp(path.join(tmpdir(), "cc-asr-"));
  let audioPath = videoPath ?? "";
  try {
    if (transcriber.name !== "sandbox" && videoPath) {
      audioPath = path.join(workDir, `${assetId}.wav`);
      await extractAudioWav(videoPath, audioPath);
    }

    const transcript = await transcriber.transcribe({ path: audioPath, durationSec });

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
    logger.info({ assetId, provider: transcript.provider, segments: transcript.segments.length }, "Asset transcribed");
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
