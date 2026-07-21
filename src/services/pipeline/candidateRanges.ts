/**
 * Pure candidate-range construction. Given scene-boundary timestamps and a
 * target clip length window, produce scene-aligned [start,end] ranges close to
 * the target length. Deterministic and side-effect free so it is unit-tested
 * directly.
 */

export interface Range {
  startSec: number;
  endSec: number;
}

export function buildCandidateRanges(
  durationSec: number,
  boundaries: number[],
  target: { min: number; max: number },
): Range[] {
  const lo = Math.max(1, target.min);
  const hi = Math.max(lo, target.max);
  if (durationSec <= 0) return [];

  // Scene-aligned cut points, clamped and deduped within (0, duration).
  const cuts = [0, ...boundaries.filter((b) => b > 0 && b < durationSec), durationSec]
    .map((n) => Number(n.toFixed(3)))
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v !== arr[i - 1]);

  const ranges: Range[] = [];

  if (cuts.length <= 2) {
    // No usable scene info: slide non-overlapping windows of length `hi`.
    for (let start = 0; start < durationSec; start += hi) {
      const end = Math.min(start + hi, durationSec);
      if (end - start >= lo) ranges.push({ startSec: start, endSec: end });
    }
    return ranges;
  }

  let start = cuts[0]!;
  for (let i = 1; i < cuts.length; i++) {
    const here = cuts[i]!;
    const len = here - start;
    if (len >= lo && len <= hi) {
      ranges.push({ startSec: start, endSec: here });
      start = here;
    } else if (len > hi) {
      // Window grew too long before hitting a boundary: hard-cut at start+hi.
      ranges.push({ startSec: start, endSec: Number((start + hi).toFixed(3)) });
      start = Number((start + hi).toFixed(3));
      i -= 1; // re-examine current boundary against the new start
    }
    // len < lo: keep accumulating (do not advance start).
  }
  // Trailing remainder that meets the minimum.
  if (durationSec - start >= lo) {
    ranges.push({ startSec: start, endSec: durationSec });
  }
  return ranges;
}
