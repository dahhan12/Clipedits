import { describe, it, expect } from "vitest";
import { estimateCostUsd, RATES } from "@/services/ops/costService";
import { evaluateStopConditions } from "@/services/ops/campaignStopConditions";

describe("estimateCostUsd", () => {
  it("prices each usage kind by its unit rate", () => {
    expect(estimateCostUsd({ kind: "ai" })).toBeCloseTo(RATES.aiCallUsd, 6);
    expect(estimateCostUsd({ kind: "render", units: 30 })).toBeCloseTo(RATES.renderPerSecUsd * 30, 6);
    expect(estimateCostUsd({ kind: "transcribe", units: 120 })).toBeCloseTo(RATES.transcribePerSecUsd * 120, 6);
    expect(estimateCostUsd({ kind: "publish" })).toBeCloseTo(RATES.publishUsd, 6);
  });

  it("defaults units to 1", () => {
    expect(estimateCostUsd({ kind: "render" })).toBeCloseTo(RATES.renderPerSecUsd, 6);
  });
});

describe("evaluateStopConditions", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("does not pause a healthy campaign", () => {
    const r = evaluateStopConditions({
      status: "ACTIVE",
      publicationCount: 2,
      maxPosts: 10,
      budgetRemaining: 500,
      deadline: "2026-12-01T00:00:00Z",
      now,
    });
    expect(r.shouldPause).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("pauses when the post cap is reached", () => {
    const r = evaluateStopConditions({ status: "ACTIVE", publicationCount: 10, maxPosts: 10, budgetRemaining: null, deadline: null, now });
    expect(r.shouldPause).toBe(true);
    expect(r.reasons[0]).toMatch(/Post cap/);
  });

  it("pauses when the budget is exhausted", () => {
    const r = evaluateStopConditions({ status: "ACTIVE", publicationCount: 1, maxPosts: null, budgetRemaining: 0, deadline: null, now });
    expect(r.shouldPause).toBe(true);
    expect(r.reasons[0]).toMatch(/budget exhausted/i);
  });

  it("pauses when the deadline has passed", () => {
    const r = evaluateStopConditions({ status: "ACTIVE", publicationCount: 1, maxPosts: null, budgetRemaining: null, deadline: "2026-01-01T00:00:00Z", now });
    expect(r.shouldPause).toBe(true);
    expect(r.reasons[0]).toMatch(/Deadline passed/);
  });

  it("ignores an unparseable deadline", () => {
    const r = evaluateStopConditions({ status: "ACTIVE", publicationCount: 1, maxPosts: null, budgetRemaining: null, deadline: "not-a-date", now });
    expect(r.shouldPause).toBe(false);
  });

  it("accumulates multiple reasons", () => {
    const r = evaluateStopConditions({ status: "ACTIVE", publicationCount: 10, maxPosts: 5, budgetRemaining: 0, deadline: "2026-01-01T00:00:00Z", now });
    expect(r.reasons.length).toBe(3);
  });
});
