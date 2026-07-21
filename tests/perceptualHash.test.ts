import { describe, it, expect } from "vitest";
import {
  computeDHashFromGray,
  computeAudioFingerprint,
  hammingHex,
  normalizedDistance,
  isNearDuplicate,
} from "@/lib/media/perceptualHash";
import { checkPerceptualDuplicate, type ComplianceContext } from "@/services/compliance/validators";

function gray(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("perceptual hashing primitives", () => {
  it("dHash sets a bit when a pixel is brighter than its right neighbour", () => {
    // 3x2 grid (w=3,h=2) → (w-1)*h = 4 bits.
    // Row0: 10 > 5 (1), 5 > 20 (0). Row1: 30 > 30 (0), 30 > 1 (1) → 1001b = 0x9
    const h = computeDHashFromGray(gray([10, 5, 20, 30, 30, 1]), 3, 2);
    expect(h).toBe(0b1001n);
  });

  it("identical frames have zero hamming distance", () => {
    const a = computeDHashFromGray(gray([10, 5, 20, 30, 30, 1]), 3, 2);
    const b = computeDHashFromGray(gray([10, 5, 20, 30, 30, 1]), 3, 2);
    expect(a).toBe(b);
  });

  it("audio fingerprint thresholds energy at the median", () => {
    // 4 buckets with energies [0,100,5000,9000]; median = upper-middle (5000),
    // so only the top bucket is strictly above → bits 0001.
    const pcm = new Int16Array([0, 0, 100, 100, 5000, 5000, 9000, 9000]);
    const fp = computeAudioFingerprint(pcm, 4);
    expect(fp).toBe(0b0001n);
  });

  it("returns null audio fingerprint for empty input", () => {
    expect(computeAudioFingerprint(new Int16Array([]), 4)).toBeNull();
  });
});

describe("hamming / distance helpers", () => {
  it("counts differing bits across hex strings", () => {
    expect(hammingHex("00", "00")).toBe(0);
    expect(hammingHex("0f", "00")).toBe(4);
    expect(hammingHex("ff", "0f")).toBe(4);
  });

  it("normalizedDistance is 0 for identical and 1 for opposite", () => {
    expect(normalizedDistance("ffff", "ffff")).toBe(0);
    expect(normalizedDistance("ffff", "0000")).toBe(1);
    expect(normalizedDistance("ff00", "ff0f")).toBeCloseTo(4 / 16, 5);
  });

  it("isNearDuplicate honours the ratio threshold and null-safety", () => {
    expect(isNearDuplicate("ffffffff", "fffffffe", 0.1)).toBe(true); // 1/32 bits
    expect(isNearDuplicate("ffffffff", "00000000", 0.1)).toBe(false);
    expect(isNearDuplicate(null, "ffff", 0.1)).toBe(false);
    expect(isNearDuplicate("ffff", null, 0.1)).toBe(false);
  });
});

describe("checkPerceptualDuplicate validator", () => {
  const base = { perceptualDuplicate: null } as unknown as ComplianceContext;

  it("passes when no near-duplicate is present", () => {
    expect(checkPerceptualDuplicate(base).outcome).toBe("PASS");
  });

  it("fails when a near-duplicate is reported", () => {
    const ctx = {
      perceptualDuplicate: { renderedClipId: "rc_123", videoDistance: 0.03, audioMatch: true },
    } as unknown as ComplianceContext;
    const finding = checkPerceptualDuplicate(ctx);
    expect(finding.outcome).toBe("FAIL");
    expect(finding.reason).toContain("rc_123");
    expect(finding.reason).toContain("audio match");
  });
});
