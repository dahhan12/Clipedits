import { describe, it, expect } from "vitest";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { estimateEarnings } from "@/services/submission/trackingService";

function rules(extra: Record<string, unknown>) {
  return CampaignRulesSchema.parse({
    campaignId: "c1",
    sourceUrl: "https://x.com/discover/c1",
    confidence: 0.9,
    ...extra,
  });
}

describe("estimateEarnings", () => {
  it("computes cpm * views / 1000", () => {
    const r = rules({ cpmByPlatform: { TIKTOK: 2 } });
    expect(estimateEarnings(r, "TIKTOK", 100_000)).toBe(200);
  });

  it("returns null when no CPM is known for the platform", () => {
    const r = rules({ cpmByPlatform: { INSTAGRAM_REELS: 3 } });
    expect(estimateEarnings(r, "TIKTOK", 100_000)).toBeNull();
  });

  it("clamps to min and max payout", () => {
    const r = rules({ cpmByPlatform: { TIKTOK: 1 }, minPayout: 50, maxPayout: 500 });
    expect(estimateEarnings(r, "TIKTOK", 10_000)).toBe(50); // 10 -> clamped up to 50
    expect(estimateEarnings(r, "TIKTOK", 10_000_000)).toBe(500); // 10000 -> clamped to 500
  });
});
