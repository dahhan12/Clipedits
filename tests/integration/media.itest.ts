import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateMedia, MediaValidationError, FfmpegUnavailable } from "@/lib/media/ffmpeg";
import { assertSafeKey, UnsafeStorageKeyError } from "@/adapters/storage/objectStore";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const d = hasFfmpeg ? describe : describe.skip;

let dir: string;
function gen(args: string[], out: string) {
  const r = spawnSync("ffmpeg", ["-y", ...args, out], { stdio: "ignore" });
  if (r.status !== 0) throw new Error("ffmpeg gen failed");
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cc-media-itest-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

// assertSafeKey needs no ffmpeg
describe("storage key path-traversal guard", () => {
  it("rejects traversal / absolute / backslash / NUL keys", () => {
    for (const k of ["../etc/passwd", "/abs/path", "a\\b", "a/../b", "x\0y", "./rel"]) {
      expect(() => assertSafeKey(k)).toThrow(UnsafeStorageKeyError);
    }
    expect(assertSafeKey("campaigns/c1/renders/x.mp4")).toBe("campaigns/c1/renders/x.mp4");
  });
});

d("hostile media validation (integration, real ffmpeg)", () => {
  it("accepts a normal short video", async () => {
    const f = path.join(dir, "ok.mp4");
    gen(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2", "-pix_fmt", "yuv420p"], f);
    const meta = await validateMedia(f);
    expect(meta.videoCodec).toBeTruthy();
  });

  it("accepts a video with no audio stream (missing audio is allowed)", async () => {
    const f = path.join(dir, "noaudio.mp4");
    gen(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=1", "-pix_fmt", "yuv420p"], f);
    const meta = await validateMedia(f);
    expect(meta.audioCodec).toBeNull();
  });

  it("rejects a corrupt / non-media file", async () => {
    const f = path.join(dir, "corrupt.mp4");
    await writeFile(f, Buffer.from("this is not a video, misleading .mp4 extension"));
    await expect(validateMedia(f)).rejects.toBeInstanceOf(MediaValidationError);
  });

  it("rejects a video that exceeds the duration cap", async () => {
    const f = path.join(dir, "long.mp4");
    gen(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=5", "-pix_fmt", "yuv420p"], f);
    await expect(
      validateMedia(f, { maxDurationSec: 2, maxDimension: 4096, maxStreams: 6 }),
    ).rejects.toBeInstanceOf(MediaValidationError);
  });

  it("rejects a video that exceeds the dimension cap", async () => {
    const f = path.join(dir, "big.mp4");
    gen(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=10:duration=1", "-pix_fmt", "yuv420p"], f);
    await expect(
      validateMedia(f, { maxDurationSec: 3600, maxDimension: 320, maxStreams: 6 }),
    ).rejects.toBeInstanceOf(MediaValidationError);
  });

  it("does not treat FfmpegUnavailable as a validation failure", () => {
    // Sanity: distinct error classes so callers can fall back vs. reject.
    expect(new FfmpegUnavailable("x")).not.toBeInstanceOf(MediaValidationError);
  });
});
