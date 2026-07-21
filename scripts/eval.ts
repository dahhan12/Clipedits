/**
 * Run the campaign-parsing evaluation and print metrics. Exits non-zero when a
 * LIVE model run misses thresholds. In sandbox (no ANTHROPIC_API_KEY) it prints
 * metrics for visibility but does not fail the process, since the fallback is
 * not a real extraction. Run: `npm run eval`.
 */
import { isSandbox } from "@/lib/config/env";
import { runEval } from "@/eval/runner";
import { THRESHOLDS } from "@/eval/scoring";

async function main() {
  const report = await runEval();
  const m = report.metrics;
  const live = !isSandbox.anthropic();

  console.log(`\nCampaignClipper AI evaluation — set v${report.version} (${m.fixtures} fixtures)`);
  console.log(`  mode:                  ${live ? "LIVE (Anthropic)" : "SANDBOX (fallback extractor)"}`);
  console.log(`  fieldPrecision:        ${m.fieldPrecision.toFixed(3)}  (>= ${THRESHOLDS.minFieldPrecision})`);
  console.log(`  fieldRecall:           ${m.fieldRecall.toFixed(3)}  (>= ${THRESHOLDS.minFieldRecall})`);
  console.log(`  criticalFieldAccuracy: ${m.criticalFieldAccuracy.toFixed(3)}  (>= ${THRESHOLDS.minCriticalFieldAccuracy})`);
  console.log(`  contradictionRecall:   ${m.contradictionRecall.toFixed(3)}  (>= ${THRESHOLDS.minContradictionRecall})`);
  console.log(`  falsePassRate:         ${m.falsePassRate.toFixed(3)}  (<= ${THRESHOLDS.maxFalsePassRate})  <-- key safety metric`);
  console.log(`  hallucinations:        ${m.hallucinationCount}  (<= ${THRESHOLDS.maxHallucinations})`);
  console.log(`  manualReviewRate:      ${m.manualReviewRate.toFixed(3)}`);

  if (!report.thresholds.passed) {
    console.log(`\n  THRESHOLD FAILURES:\n    - ${report.thresholds.failures.join("\n    - ")}`);
  } else {
    console.log(`\n  All thresholds passed.`);
  }

  if (live && !report.thresholds.passed) {
    console.error("\nLive evaluation failed thresholds.");
    process.exit(1);
  }
  if (!live) {
    console.log("\n(Sandbox mode: not failing the process; connect ANTHROPIC_API_KEY for a real evaluation.)");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
