import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMedia, FfmpegUnavailable, MediaTimeoutError } from "./ffmpeg";

/**
 * Perceptual (content) fingerprinting for near-duplicate detection.
 *
 * These are NOT cryptographic hashes: they are designed so that two clips that
 * look/sound alike — even after a re-encode, bitrate change, or minor caption
 * tweak — produce hashes a small Hamming distance apart. They complement the
 * exact `renderConfigHash` idempotency key (which only catches byte-identical
 * re-renders of the same candidate).
 *
 *  - Video: a difference hash (dHash) over several evenly-spaced grayscale
 *    frames. Each frame → 64 bits; frames are concatenated.
 *  - Audio: a coarse loudness-envelope fingerprint (energy per time bucket,
 *    thresholded at the median) → 64 bits, robust to volume/codec changes.
 *
 * Both return null when ffmpeg is unavailable or the stream is absent, so the
 * caller records "unknown" rather than a fabricated match.
 */

const VIDEO_FRAMES = 5; // sampled frames
const HASH_W = 9; // dHash needs width+1 columns
const HASH_H = 8;
const AUDIO_BUCKETS = 64;
const AUDIO_SAMPLE_RATE = 8000;

/** Bits per hex char = 4; each video frame contributes 64 bits = 16 hex chars. */
export function computeDHashFromGray(gray: Uint8Array, w: number, h: number): bigint {
  // Difference hash: for each row, each pixel brighter than its right neighbour
  // contributes a 1 bit. Produces (w-1)*h bits.
  let bits = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const left = gray[y * w + x] ?? 0;
      const right = gray[y * w + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits;
}

function toHex(value: bigint, bits: number): string {
  const hexLen = Math.ceil(bits / 4);
  return value.toString(16).padStart(hexLen, "0");
}

/**
 * Compute the video perceptual hash: sample VIDEO_FRAMES frames, scale each to
 * HASH_W x HASH_H grayscale raw bytes, dHash each, concatenate to a hex string.
 * Returns null if ffmpeg is unavailable or no frames were produced.
 */
export async function computePerceptualHash(videoPath: string): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "cc-phash-"));
  const rawPath = path.join(dir, "frames.gray");
  try {
    // `thumbnail` picks representative frames; we then take the first N. Scale to
    // HASH_W x HASH_H grayscale, output raw (HASH_W*HASH_H bytes per frame).
    await runMedia(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-vf",
        `select='not(mod(n\\,10))',scale=${HASH_W}:${HASH_H},format=gray`,
        "-vsync",
        "vfr",
        "-frames:v",
        String(VIDEO_FRAMES),
        "-f",
        "rawvideo",
        rawPath,
      ],
      { timeoutMs: 60_000 },
    );
    const buf = await readFile(rawPath);
    const frameBytes = HASH_W * HASH_H;
    const frameCount = Math.floor(buf.length / frameBytes);
    if (frameCount === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < frameCount; i++) {
      const slice = buf.subarray(i * frameBytes, (i + 1) * frameBytes);
      parts.push(toHex(computeDHashFromGray(slice, HASH_W, HASH_H), (HASH_W - 1) * HASH_H));
    }
    return parts.join("");
  } catch (err) {
    if (err instanceof FfmpegUnavailable || err instanceof MediaTimeoutError) return null;
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Build a 64-bit fingerprint from a mono PCM envelope (median-thresholded energy). */
export function computeAudioFingerprint(pcm: Int16Array, buckets: number): bigint | null {
  if (pcm.length === 0) return null;
  const per = Math.floor(pcm.length / buckets);
  if (per === 0) return null;
  const energies: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    const start = b * per;
    for (let i = 0; i < per; i++) {
      const s = pcm[start + i] ?? 0;
      sum += s * s;
    }
    energies.push(Math.sqrt(sum / per));
  }
  const sorted = [...energies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let bits = 0n;
  for (const e of energies) bits = (bits << 1n) | (e > median ? 1n : 0n);
  return bits;
}

/**
 * Compute the audio perceptual hash from the video's audio track. Returns null
 * if there is no audio, the track is silent/too short, or ffmpeg is missing.
 */
export async function computeAudioHash(videoPath: string): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "cc-ahash-"));
  const pcmPath = path.join(dir, "audio.pcm");
  try {
    await runMedia(
      "ffmpeg",
      ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", String(AUDIO_SAMPLE_RATE), "-f", "s16le", pcmPath],
      { timeoutMs: 60_000 },
    );
    const buf = await readFile(pcmPath);
    if (buf.length < 2) return null;
    // Interpret as little-endian signed 16-bit samples.
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    const fp = computeAudioFingerprint(samples, AUDIO_BUCKETS);
    return fp == null ? null : toHex(fp, AUDIO_BUCKETS);
  } catch (err) {
    if (err instanceof FfmpegUnavailable || err instanceof MediaTimeoutError) return null;
    // A stream with no audio makes ffmpeg exit non-zero; treat as "no audio".
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Hamming distance between two equal-length hex fingerprints (bit differences). */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) {
    // Compare the common prefix length; mismatched lengths are heavily penalised.
    const len = Math.min(a.length, b.length);
    return hammingHex(a.slice(0, len), b.slice(0, len)) + Math.abs(a.length - b.length) * 4;
  }
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = (parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)) & 0xf;
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/** Fraction of differing bits (0 = identical, 1 = fully different). */
export function normalizedDistance(a: string, b: string): number {
  const bits = Math.max(a.length, b.length) * 4;
  if (bits === 0) return 1;
  return hammingHex(a, b) / bits;
}

/**
 * Near-duplicate if the perceptual distance is within `maxRatio` (default 0.10,
 * i.e. ≤10% of bits differ). Empty/absent hashes never match.
 */
export function isNearDuplicate(a: string | null, b: string | null, maxRatio = 0.1): boolean {
  if (!a || !b) return false;
  return normalizedDistance(a, b) <= maxRatio;
}
