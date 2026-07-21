import { spawn } from "node:child_process";

/**
 * Thin wrappers over the system `ffmpeg`/`ffprobe` binaries. Each helper
 * degrades gracefully: if the binary is missing (e.g. in a bare sandbox) it
 * throws `FfmpegUnavailable`, letting callers fall back to a deterministic
 * heuristic rather than crashing the pipeline.
 */

export class FfmpegUnavailable extends Error {}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, args);
    } catch (err) {
      reject(new FfmpegUnavailable(`${bin} not spawnable: ${(err as Error).message}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new FfmpegUnavailable(`${bin} not found on PATH`)
          : err,
      ),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

export interface VideoMeta {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
}

/** Probe width/height/duration/codecs/container of a media file via ffprobe. */
export async function probeVideoMeta(path: string): Promise<VideoMeta> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const json = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  const v = json.streams?.find((s) => s.codec_type === "video");
  const a = json.streams?.find((s) => s.codec_type === "audio");
  const dur = json.format?.duration ? Number.parseFloat(json.format.duration) : null;
  return {
    width: v?.width ?? null,
    height: v?.height ?? null,
    durationSec: Number.isFinite(dur) ? dur : null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    container: json.format?.format_name ?? null,
  };
}

/** Return media duration in seconds via ffprobe. */
export async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const dur = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) throw new Error("Could not parse duration");
  return dur;
}

export interface RenderClipOptions {
  inputPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  /** Overlay text lines to burn in (already gated by permission/requirement). */
  burnInText?: string[];
  /** EBU R128 loudness normalization of the audio track. Default true. */
  normalizeAudio?: boolean;
  /** Trim leading/trailing silence (may shorten duration). Default false. */
  trimSilence?: boolean;
  /** x264 CRF quality/compression (lower = higher quality). Default 23. */
  crf?: number;
}

/**
 * Render a 9:16 (or arbitrary WxH) clip from a source video with FFmpeg:
 * trims [start,end], scales to cover and center-crops to the target frame,
 * loudness-normalizes and (optionally) silence-trims the audio, and encodes
 * H.264 video + AAC audio into a compressed MP4. Optional text is burned in
 * with the drawtext filter (used as the FFmpeg overlay path / Remotion fallback).
 */
export async function renderClip9x16(opts: RenderClipOptions): Promise<void> {
  const { width: w, height: h } = opts;
  const vfilters = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
  ];
  opts.burnInText?.forEach((line, i) => {
    const safe = line.replace(/[\\:']/g, (c) => `\\${c}`).replace(/,/g, "\\,");
    const y = `h-${(opts.burnInText!.length - i) * 90}`;
    vfilters.push(
      `drawtext=text='${safe}':fontcolor=white:fontsize=42:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=${y}`,
    );
  });

  const afilters: string[] = [];
  if (opts.trimSilence) {
    afilters.push("silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB");
  }
  if (opts.normalizeAudio !== false) afilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

  const args = [
    "-y",
    "-ss",
    opts.startSec.toFixed(3),
    "-to",
    opts.endSec.toFixed(3),
    "-i",
    opts.inputPath,
    "-vf",
    vfilters.join(","),
    ...(afilters.length ? ["-af", afilters.join(",")] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(opts.crf ?? 23),
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
  await run("ffmpeg", args);
}

/** Extract a mono 16 kHz WAV audio track (ideal for ASR) from a video. */
export async function extractAudioWav(videoPath: string, outPath: string): Promise<void> {
  await run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outPath]);
}

/** Extract a single JPEG thumbnail frame at `atSec` from a video. */
export async function extractThumbnail(videoPath: string, atSec: number, outPath: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-ss",
    Math.max(0, atSec).toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outPath,
  ]);
}

/**
 * Detect scene-change timestamps (seconds) using ffmpeg's `select` filter.
 * `threshold` is the scene-score cut (0..1); higher = fewer boundaries.
 */
export async function detectSceneBoundaries(path: string, threshold = 0.4): Promise<number[]> {
  const { stderr } = await run("ffmpeg", [
    "-i",
    path,
    "-filter:v",
    `select='gt(scene,${threshold})',showinfo`,
    "-f",
    "null",
    "-",
  ]);
  const times = new Set<number>();
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
    const t = Number.parseFloat(m[1]!);
    if (Number.isFinite(t)) times.add(Number(t.toFixed(3)));
  }
  return [...times].sort((a, b) => a - b);
}
