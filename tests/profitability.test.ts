import { describe, it, expect } from "vitest";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import {
  scoreCampaign,
  shouldProcess,
  effectiveCpm,
  remainingBudgetFactor,
  timeRemainingFactor,
} from "@/services/scoring/profitability";

function rules(extra: Record<string, unknown>) {
  return CampaignRulesSchema.parse({
    campaignId: "c1",
    sourceUrl: "https://x.com/discover/c1",
    confidence: 0.95,
    ...extra,
  });
}

const now = new Date("2026-01-01T00:00:00Z");

describe("profitability primitives", () => {
  it("averages CPM across supported platforms", () => {
    const r = rules({ supportedPlatforms: ["TIKTOK", "YOUTUBE_SHORTS"], cpmByPlatform: { TIKTOK: 2, YOUTUBE_SHORTS: 4 } });
    expect(effectiveCpm(r)).toBe(3);
  });

  it("budget factor is 0 when depleted, 0.5 when unknown", () => {
    expect(remainingBudgetFactor(rules({ budgetRemaining: 0, budgetTotal: 100 }))).toBe(0);
    expect(remainingBudgetFactor(rules({}))).toBe(0.5);
    expect(remainingBudgetFactor(rules({ budgetRemaining: 50, budgetTotal: 100 }))).toBe(0.5);
  });

  it("time factor is 0 past the deadline", () => {
    expect(timeRemainingFactor(rules({ deadline: "2025-01-01T00:00:00+00:00" }), now)).toBe(0);
  });
});

describe("scoreCampaign", () => {
  it("computes revenue, profit and priority", () => {
    const r = rules({
      supportedPlatforms: ["TIKTOK"],
      cpmByPlatform: { TIKTOK: 2 },
      minViews: 100_000,
      budgetRemaining: 100,
      budgetTotal: 100,
      deadline: "2026-01-16T00:00:00+00:00", // ~15 days -> factor 0.5
    });
    const s = scoreCampaign(r, { now });
    expect(s.estimatedRevenue).toBe(200); // 100000 * 2 / 1000
    // profit = 200 - 0.5 - 0.1 - 40 = 159.4
    expect(s.estimatedProfit).toBeCloseTo(159.4, 1);
    expect(s.priorityScore).toBeGreaterThan(0);
  });
});

describe("shouldProcess", () => {
  it("stops on closed campaign / depleted budget / low confidence", () => {
    const r = rules({ cpmByPlatform: { TIKTOK: 2 }, supportedPlatforms: ["TIKTOK"], minViews: 100000, budgetRemaining: 100, budgetTotal: 100 });
    expect(shouldProcess(r, "CLOSED", { now }).process).toBe(false);
    expect(shouldProcess(rules({ confidence: 0.5 }), "PARSED", { now }).process).toBe(false);
  });

  it("processes a healthy, profitable campaign", () => {
    const r = rules({
      supportedPlatforms: ["TIKTOK"],
      cpmByPlatform: { TIKTOK: 3 },
      minViews: 100_000,
      budgetRemaining: 500,
      budgetTotal: 1000,
      deadline: "2026-02-01T00:00:00+00:00",
    });
    expect(shouldProcess(r, "PARSED", { now }).process).toBe(true);
  });
});
