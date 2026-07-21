import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { computePerceptualHash, computeAudioHash, normalizedDistance } from "@/lib/media/perceptualHash";

/**
 * Real ffmpeg perceptual/audio hashing. Generates synthetic clips and asserts:
 *  - a clip is a perceptual match for its own re-encode (near-zero distance),
 *  - a visually different clip is far away,
 *  - audio hashing yields a stable fingerprint.
 * Self-skips where ffmpeg is unavailable (CI provides it).
 */
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const d = hasFfmpeg ? describe : describe.skip;

let dir: string;
function gen(args: string[], out: string) {
  const r = spawnSync("ffmpeg", ["-y", ...args, out], { stdio: "ignore" });
  if (r.status !== 0) throw new Error("ffmpeg gen failed");
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cc-phash-itest-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

d("perceptual/audio hashing (real ffmpeg)", () => {
  it("matches a clip against its own re-encode and separates a different clip", async () => {
    const a = path.join(dir, "a.mp4");
    const aReencoded = path.join(dir, "a2.mp4");
    const b = path.join(dir, "b.mp4");
    gen(["-f", "lavfi", "-i", "testsrc=size=320x568:rate=15:duration=3", "-pix_fmt", "yuv420p"], a);
    // Re-encode of A at a different bitrate/preset — perceptually the same.
    gen(["-i", a, "-c:v", "libx264", "-crf", "34", "-preset", "ultrafast", "-pix_fmt", "yuv420p"], aReencoded);
    // A visually distinct source.
    gen(["-f", "lavfi", "-i", "smptebars=size=320x568:rate=15:duration=3", "-pix_fmt", "yuv420p"], b);

    const ha = await computePerceptualHash(a);
    const ha2 = await computePerceptualHash(aReencoded);
    const hb = await computePerceptualHash(b);

    expect(ha).toBeTruthy();
    expect(ha2).toBeTruthy();
    expect(hb).toBeTruthy();

    const selfDist = normalizedDistance(ha!, ha2!);
    const crossDist = normalizedDistance(ha!, hb!);
    expect(selfDist).toBeLessThanOrEqual(0.1); // near-duplicate
    expect(crossDist).toBeGreaterThan(selfDist); // clearly further apart
  }, 60_000);

  it("produces a stable audio fingerprint and null when there is no audio", async () => {
    const withAudio = path.join(dir, "aud.mp4");
    const noAudio = path.join(dir, "silent.mp4");
    gen(
      [
        "-f", "lavfi", "-i", "testsrc=size=320x568:rate=15:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      ],
      withAudio,
    );
    gen(["-f", "lavfi", "-i", "testsrc=size=320x568:rate=15:duration=3", "-pix_fmt", "yuv420p"], noAudio);

    const h1 = await computeAudioHash(withAudio);
    const h2 = await computeAudioHash(withAudio);
    expect(h1).toBeTruthy();
    expect(h1).toBe(h2); // deterministic
    expect(await computeAudioHash(noAudio)).toBeNull(); // no audio track
  }, 60_000);
});
