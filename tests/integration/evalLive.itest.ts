import { describe, it, expect } from "vitest";
import { runEval } from "@/eval/runner";

/**
 * LIVE evaluation gate. Runs the real parser (Anthropic) over the fixture set
 * and asserts the release thresholds. Self-skips without ANTHROPIC_API_KEY so
 * unit/integration CI stays green until a key is provided in staging.
 */
const live = !!process.env.ANTHROPIC_API_KEY;
const d = live ? describe : describe.skip;

d("AI evaluation — LIVE thresholds", () => {
  it("meets extraction thresholds against the fixture set", async () => {
    const report = await runEval();
    if (!report.thresholds.passed) {
      // Surface the exact failures in the assertion message.
      throw new Error("Eval thresholds failed:\n  " + report.thresholds.failures.join("\n  "));
    }
    expect(report.thresholds.passed).toBe(true);
    expect(report.metrics.falsePassRate).toBeLessThanOrEqual(0.05);
  }, 120_000);
});
