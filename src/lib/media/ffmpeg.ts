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
