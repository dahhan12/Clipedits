import { describe, it, expect } from "vitest";
import { buildCandidateRanges } from "@/services/pipeline/candidateRanges";
import { resolveTargets } from "@/adapters/ingestion/resolvers";

describe("buildCandidateRanges", () => {
  it("returns nothing for zero duration", () => {
    expect(buildCandidateRanges(0, [], { min: 15, max: 60 })).toEqual([]);
  });

  it("slides fixed windows when there are no scene boundaries", () => {
    const ranges = buildCandidateRanges(140, [], { min: 15, max: 60 });
    expect(ranges.length).toBe(3); // 0-60, 60-120, 120-140 (20s >= 15)
    expect(ranges[0]).toEqual({ startSec: 0, endSec: 60 });
    expect(ranges[2]).toEqual({ startSec: 120, endSec: 140 });
  });

  it("drops a trailing window shorter than the minimum", () => {
    const ranges = buildCandidateRanges(65, [], { min: 15, max: 60 });
    // 0-60 kept; 60-65 (5s) dropped.
    expect(ranges).toEqual([{ startSec: 0, endSec: 60 }]);
  });

  it("aligns to scene boundaries within the target window", () => {
    const ranges = buildCandidateRanges(100, [20, 45, 70], { min: 15, max: 40 });
    for (const r of ranges) {
      const len = r.endSec - r.startSec;
      expect(len).toBeGreaterThanOrEqual(15);
      expect(len).toBeLessThanOrEqual(40);
    }
    // ranges must be non-overlapping and ordered
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.startSec).toBeGreaterThanOrEqual(ranges[i - 1]!.endSec);
    }
  });

  it("hard-cuts a stretch that exceeds max before any boundary", () => {
    const ranges = buildCandidateRanges(200, [130], { min: 15, max: 40 });
    expect(ranges.every((r) => r.endSec - r.startSec <= 40)).toBe(true);
  });
});

describe("resolveTargets", () => {
  it("rewrites a Google Drive file link to a direct-download url", () => {
    const t = resolveTargets("https://drive.google.com/file/d/ABC123/view", "GOOGLE_DRIVE_FILE");
    expect(t[0]!.directUrl).toBe("https://drive.google.com/uc?export=download&id=ABC123");
  });

  it("forces dl=1 on a Dropbox share link", () => {
    const t = resolveTargets("https://www.dropbox.com/s/xyz/clip.mp4?dl=0", "DROPBOX_FILE");
    expect(t[0]!.directUrl).toContain("dl=1");
    expect(t[0]!.directUrl).not.toContain("dl=0");
  });

  it("flags YouTube as needing an extractor rather than downloading", () => {
    const t = resolveTargets("https://youtu.be/abc", "YOUTUBE");
    expect(t[0]!.requiresExtractor).toBe("youtube");
    expect(t[0]!.directUrl).toBeUndefined();
  });

  it("passes a direct video url straight through", () => {
    const t = resolveTargets("https://cdn.example.com/a/b/final.mp4", "DIRECT_VIDEO");
    expect(t[0]!.directUrl).toBe("https://cdn.example.com/a/b/final.mp4");
    expect(t[0]!.filename).toBe("final.mp4");
  });
});
