import { describe, it, expect } from "vitest";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import {
  runDeterministicChecks,
  overallOutcome,
  checkAspectRatio,
  checkDuration,
  checkFileFormat,
  checkMandatoryHashtags,
  checkDeadline,
  checkMaxPosts,
  checkRemainingBudget,
  type ComplianceContext,
} from "@/services/compliance/validators";

function ctx(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  const rules = CampaignRulesSchema.parse({
    campaignId: "c1",
    sourceUrl: "https://x.com/discover/c1",
    confidence: 0.9,
    supportedPlatforms: ["TIKTOK"],
    requiredHashtags: ["#ad"],
    requiredVideoDurationSec: { min: 15, max: 60 },
    budgetRemaining: 100,
    ...(overrides.rules ? {} : {}),
  });
  return {
    rules,
    campaignStatus: "ACTIVE",
    durationSec: 30,
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    container: "mov,mp4,m4a",
    bytes: 5 * 1024 * 1024,
    overlaysApplied: [],
    captions: { TIKTOK: "great clip #ad" },
    originalSource: "https://cdn.example.com/v.mp4",
    publicationCount: 0,
    duplicate: false,
    duplicateCaption: false,
    publicVerified: null,
    targetPlatforms: ["TIKTOK"],
    now: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("deterministic validators", () => {
  it("passes a fully compliant clip", () => {
    const findings = runDeterministicChecks(ctx());
    expect(overallOutcome(findings)).toBe("PASS");
  });

  it("fails duration outside bounds", () => {
    expect(checkDuration(ctx({ durationSec: 90 })).outcome).toBe("FAIL");
    expect(checkDuration(ctx({ durationSec: 5 })).outcome).toBe("FAIL");
    expect(checkDuration(ctx({ durationSec: 30 })).outcome).toBe("PASS");
  });

  it("reviews duration when unknown", () => {
    expect(checkDuration(ctx({ durationSec: null })).outcome).toBe("REVIEW");
  });

  it("checks 9:16 aspect ratio within tolerance", () => {
    expect(checkAspectRatio(ctx({ width: 1080, height: 1920 })).outcome).toBe("PASS");
    expect(checkAspectRatio(ctx({ width: 1920, height: 1080 })).outcome).toBe("FAIL");
  });

  it("requires mp4/h264/aac", () => {
    expect(checkFileFormat(ctx()).outcome).toBe("PASS");
    expect(checkFileFormat(ctx({ videoCodec: "vp9", container: "webm" })).outcome).toBe("FAIL");
  });

  it("fails when a mandatory hashtag is missing from a caption", () => {
    expect(checkMandatoryHashtags(ctx({ captions: { TIKTOK: "no tag here" } })).outcome).toBe("FAIL");
    expect(checkMandatoryHashtags(ctx({ captions: { TIKTOK: "yes #ad" } })).outcome).toBe("PASS");
  });

  it("enforces the deadline", () => {
    const past = CampaignRulesSchema.parse({
      campaignId: "c1",
      sourceUrl: "https://x.com/discover/c1",
      confidence: 0.9,
      deadline: "2025-01-01T00:00:00+00:00",
    });
    expect(checkDeadline(ctx({ rules: past })).outcome).toBe("FAIL");
  });

  it("enforces max posts", () => {
    const rules = CampaignRulesSchema.parse({
      campaignId: "c1",
      sourceUrl: "https://x.com/discover/c1",
      confidence: 0.9,
      maxPosts: 2,
    });
    expect(checkMaxPosts(ctx({ rules, publicationCount: 2 })).outcome).toBe("FAIL");
    expect(checkMaxPosts(ctx({ rules, publicationCount: 1 })).outcome).toBe("PASS");
  });

  it("fails on zero remaining budget and reviews when unknown", () => {
    const zero = CampaignRulesSchema.parse({
      campaignId: "c1",
      sourceUrl: "https://x.com/discover/c1",
      confidence: 0.9,
      budgetRemaining: 0,
    });
    expect(checkRemainingBudget(ctx({ rules: zero })).outcome).toBe("FAIL");
    const unknown = CampaignRulesSchema.parse({
      campaignId: "c1",
      sourceUrl: "https://x.com/discover/c1",
      confidence: 0.9,
    });
    expect(checkRemainingBudget(ctx({ rules: unknown })).outcome).toBe("REVIEW");
  });

  it("rolls up to FAIL when any check fails", () => {
    const findings = runDeterministicChecks(ctx({ duplicate: true }));
    expect(overallOutcome(findings)).toBe("FAIL");
  });

  it("fails a closed campaign", () => {
    const findings = runDeterministicChecks(ctx({ campaignStatus: "CLOSED" }));
    expect(overallOutcome(findings)).toBe("FAIL");
  });
});
