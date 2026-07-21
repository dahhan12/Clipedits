import { describe, it, expect } from "vitest";
import { CampaignRulesSchema, type CampaignRules } from "@/lib/schemas/campaign";
import { scoreFixture, aggregate, checkThresholds, type FixtureExpectation, type Prediction } from "@/eval/scoring";
import { FIXTURES } from "@/eval/fixtures";

function rules(extra: Partial<CampaignRules>): CampaignRules {
  return CampaignRulesSchema.parse({ campaignId: "c", sourceUrl: "https://x.com/discover/c", confidence: 0.95, ...extra });
}
function pred(r: Partial<CampaignRules>, needsManualReview = false): Prediction {
  return { rules: rules(r), needsManualReview };
}

describe("eval scoring engine (measurement correctness)", () => {
  const exp: FixtureExpectation = {
    fields: {
      supportedPlatforms: ["TIKTOK"],
      durationMin: 15,
      durationMax: 60,
      requiredHashtags: ["#ad"],
      deadline: "2026-12-01",
    },
    missing: ["requiredMentions"],
  };

  it("scores a perfect prediction as fully correct with no false pass", () => {
    const p = pred({
      supportedPlatforms: ["TIKTOK"],
      requiredVideoDurationSec: { min: 15, max: 60 },
      requiredHashtags: ["#ad"],
      deadline: "2026-12-01T00:00:00+00:00",
    });
    const s = scoreFixture("perfect", exp, p);
    const m = aggregate([s]);
    expect(m.fieldPrecision).toBe(1);
    expect(m.fieldRecall).toBe(1);
    expect(m.criticalFieldAccuracy).toBe(1);
    expect(s.falsePass).toBe(false);
  });

  it("flags a FALSE PASS when a critical field is wrong but the model is confident", () => {
    const p = pred(
      {
        supportedPlatforms: ["YOUTUBE_SHORTS"], // wrong critical field
        requiredVideoDurationSec: { min: 15, max: 60 },
        requiredHashtags: ["#ad"],
        deadline: "2026-12-01T00:00:00+00:00",
      },
      false, // confident, no manual review
    );
    const s = scoreFixture("wrong-critical", exp, p);
    expect(s.criticalWrong).toBeGreaterThan(0);
    expect(s.falsePass).toBe(true);
    expect(aggregate([s]).falsePassRate).toBe(1);
  });

  it("does NOT flag a false pass when the model asks for manual review", () => {
    const p = pred({ supportedPlatforms: ["YOUTUBE_SHORTS"] }, true);
    const s = scoreFixture("wrong-but-review", exp, p);
    expect(s.falsePass).toBe(false);
  });

  it("counts hallucinations for invented omitted fields", () => {
    const p = pred({ supportedPlatforms: ["TIKTOK"], requiredMentions: ["@invented"] });
    const s = scoreFixture("hallucinated", exp, p);
    expect(s.hallucinations).toBe(1);
    expect(aggregate([s]).hallucinationCount).toBe(1);
  });

  it("measures contradiction recall (missed contradiction = false pass)", () => {
    const contraExp: FixtureExpectation = { fields: { supportedPlatforms: ["TIKTOK"] }, hasContradiction: true };
    const missed = scoreFixture("missed", contraExp, pred({ supportedPlatforms: ["TIKTOK"] }, false));
    expect(missed.falsePass).toBe(true);
    expect(aggregate([missed]).contradictionRecall).toBe(0);

    const caught = scoreFixture("caught", contraExp, pred({ supportedPlatforms: ["TIKTOK"], uncertainties: ["conflict"] }, true));
    expect(aggregate([caught]).contradictionRecall).toBe(1);
  });

  it("checkThresholds fails when the false-pass rate is too high", () => {
    const badMetrics = aggregate([scoreFixture("x", exp, pred({ supportedPlatforms: ["YOUTUBE_SHORTS"] }, false))]);
    expect(checkThresholds(badMetrics).passed).toBe(false);
    expect(checkThresholds(badMetrics).failures.join(" ")).toMatch(/falsePassRate|criticalFieldAccuracy/);
  });
});

describe("eval fixture set", () => {
  it("has at least 25 fixtures across the required categories", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(25);
    const cats = new Set(FIXTURES.map((f) => f.category));
    for (const c of ["clean", "ambiguous", "contradictory", "missing", "revised"]) {
      expect(cats.has(c as (typeof FIXTURES)[number]["category"])).toBe(true);
    }
  });

  it("every fixture has unique id and non-trivial input", () => {
    const ids = new Set(FIXTURES.map((f) => f.id));
    expect(ids.size).toBe(FIXTURES.length);
    for (const f of FIXTURES) expect(f.inputText.length).toBeGreaterThan(10);
  });
});
