import { describe, it, expect } from "vitest";
import {
  CampaignRulesSchema,
  deriveRuleStatus,
  DiscoveredCampaignSchema,
} from "@/lib/schemas/campaign";
import { extractDiscoverIds } from "@/adapters/discovery/browser";

const base = {
  campaignId: "abc123",
  sourceUrl: "https://www.contentrewards.com/discover/abc123",
  confidence: 0.9,
};

describe("CampaignRulesSchema", () => {
  it("applies array/object defaults for omitted fields", () => {
    const r = CampaignRulesSchema.parse(base);
    expect(r.supportedPlatforms).toEqual([]);
    expect(r.requiredHashtags).toEqual([]);
    expect(r.cpmByPlatform).toEqual({});
    expect(r.title).toBeNull();
  });

  it("rejects out-of-range confidence", () => {
    expect(CampaignRulesSchema.safeParse({ ...base, confidence: 2 }).success).toBe(false);
  });

  it("validates aspect ratio format", () => {
    expect(CampaignRulesSchema.safeParse({ ...base, requiredAspectRatio: "9x16" }).success).toBe(false);
    expect(CampaignRulesSchema.safeParse({ ...base, requiredAspectRatio: "9:16" }).success).toBe(true);
  });
});

describe("deriveRuleStatus", () => {
  it("flags low confidence for manual review", () => {
    const r = CampaignRulesSchema.parse({ ...base, confidence: 0.2 });
    expect(deriveRuleStatus(r)).toBe("NEEDS_MANUAL_REVIEW");
  });
  it("flags declared uncertainties for manual review", () => {
    const r = CampaignRulesSchema.parse({ ...base, uncertainties: ["conflicting durations"] });
    expect(deriveRuleStatus(r)).toBe("NEEDS_MANUAL_REVIEW");
  });
  it("passes a clean high-confidence extraction", () => {
    expect(deriveRuleStatus(CampaignRulesSchema.parse(base))).toBe("PARSED");
  });
});

describe("extractDiscoverIds", () => {
  it("extracts and dedupes campaign ids from /discover/:id urls", () => {
    const ids = extractDiscoverIds([
      "https://www.contentrewards.com/discover/abc123",
      "https://www.contentrewards.com/discover/abc123?ref=x",
      "https://www.contentrewards.com/discover/def456",
      "https://www.contentrewards.com/other",
    ]);
    expect(ids.map((i) => i.id).sort()).toEqual(["abc123", "def456"]);
  });
});

describe("DiscoveredCampaignSchema", () => {
  it("requires a page hash", () => {
    expect(
      DiscoveredCampaignSchema.safeParse({
        source: "CONTENT_REWARDS",
        externalId: "abc",
        sourceUrl: "https://x.com/discover/abc",
      }).success,
    ).toBe(false);
  });
});
