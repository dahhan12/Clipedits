import { parseCampaign } from "@/services/parsing/campaignParser";
import { deriveRuleStatus, type CampaignRules } from "@/lib/schemas/campaign";
import { FIXTURES, EVAL_SET_VERSION } from "./fixtures";
import { scoreFixture, aggregate, checkThresholds, type FixtureScore, type AggregateMetrics, type ThresholdCheck } from "./scoring";

/**
 * The evaluation runner. Runs an extractor over every fixture and reports
 * aggregate metrics + a threshold verdict. The default extractor uses the real
 * campaign parser (Claude when configured; the low-confidence sandbox fallback
 * otherwise — which will NOT meet thresholds, honestly reflecting that no real
 * extraction happened).
 */

export type Extractor = (
  inputText: string,
  id: string,
) => Promise<{ rules: CampaignRules; needsManualReview: boolean }>;

export const defaultExtractor: Extractor = async (inputText, id) => {
  const { rules } = await parseCampaign({
    campaignId: id,
    sourceUrl: `https://example.com/discover/${id}`,
    pageTextOverride: inputText,
  });
  return { rules, needsManualReview: deriveRuleStatus(rules) === "NEEDS_MANUAL_REVIEW" };
};

export interface EvalReport {
  version: string;
  scores: FixtureScore[];
  metrics: AggregateMetrics;
  thresholds: ThresholdCheck;
}

export async function runEval(extract: Extractor = defaultExtractor): Promise<EvalReport> {
  const scores: FixtureScore[] = [];
  for (const f of FIXTURES) {
    const pred = await extract(f.inputText, f.id);
    scores.push(scoreFixture(f.id, f.expectation, pred));
  }
  const metrics = aggregate(scores);
  return { version: EVAL_SET_VERSION, scores, metrics, thresholds: checkThresholds(metrics) };
}
