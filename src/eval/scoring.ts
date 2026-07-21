import type { CampaignRules } from "@/lib/schemas/campaign";
import { CRITICAL_FIELDS, getField, isPopulated, equalValue, type FieldKey } from "./fields";

/**
 * Scoring for the campaign-parsing eval harness. Pure and unit-tested so the
 * MEASUREMENT itself is trustworthy — "valid Zod output" is never treated as
 * proof of correctness.
 */

export interface FixtureExpectation {
  /** Expected values for the fields this fixture asserts. */
  fields: Partial<Record<FieldKey, string | number | boolean | string[] | null>>;
  /** True if the fixture contains contradictory/ambiguous rules the model should flag. */
  hasContradiction?: boolean;
  /** Field keys the fixture deliberately OMITS (model must not invent them). */
  missing?: FieldKey[];
}

export interface Prediction {
  rules: CampaignRules;
  /** Whether the model flagged manual review (derived rule status). */
  needsManualReview: boolean;
}

export interface FixtureScore {
  id: string;
  truePositives: number;
  populatedExpected: number;
  populatedPredicted: number;
  criticalTotal: number;
  criticalCorrect: number;
  criticalWrong: number;
  hallucinations: number;
  contradictionExpected: boolean;
  contradictionDetected: boolean;
  needsManualReview: boolean;
  /** A false PASS: model confident (no manual review) yet a critical field is wrong,
   *  or it missed a required contradiction. THE key safety metric. */
  falsePass: boolean;
}

export function scoreFixture(id: string, exp: FixtureExpectation, pred: Prediction): FixtureScore {
  const asserted = Object.keys(exp.fields) as FieldKey[];
  let tp = 0;
  let populatedExpected = 0;
  let populatedPredicted = 0;
  let criticalTotal = 0;
  let criticalCorrect = 0;
  let criticalWrong = 0;

  for (const key of asserted) {
    const expected = exp.fields[key] ?? null;
    const predicted = getField(pred.rules, key);
    const expPop = isPopulated(expected);
    const predPop = isPopulated(predicted);
    if (expPop) populatedExpected += 1;
    if (predPop) populatedPredicted += 1;

    const correct = equalValue(key, expected, predicted);
    if (expPop && predPop && correct) tp += 1;

    if (CRITICAL_FIELDS.includes(key) && expPop) {
      criticalTotal += 1;
      if (correct) criticalCorrect += 1;
      else criticalWrong += 1;
    }
  }

  let hallucinations = 0;
  for (const key of exp.missing ?? []) {
    if (isPopulated(getField(pred.rules, key))) hallucinations += 1;
  }

  const contradictionExpected = !!exp.hasContradiction;
  const contradictionDetected = pred.rules.uncertainties.length > 0 || pred.needsManualReview;

  const missedContradiction = contradictionExpected && !contradictionDetected;
  const falsePass = !pred.needsManualReview && (criticalWrong > 0 || missedContradiction);

  return {
    id,
    truePositives: tp,
    populatedExpected,
    populatedPredicted,
    criticalTotal,
    criticalCorrect,
    criticalWrong,
    hallucinations,
    contradictionExpected,
    contradictionDetected,
    needsManualReview: pred.needsManualReview,
    falsePass,
  };
}

export interface AggregateMetrics {
  fixtures: number;
  fieldPrecision: number;
  fieldRecall: number;
  criticalFieldAccuracy: number;
  hallucinationCount: number;
  contradictionRecall: number;
  falsePassRate: number;
  manualReviewRate: number;
}

export function aggregate(scores: FixtureScore[]): AggregateMetrics {
  const sum = (f: (s: FixtureScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const tp = sum((s) => s.truePositives);
  const pe = sum((s) => s.populatedExpected);
  const pp = sum((s) => s.populatedPredicted);
  const ct = sum((s) => s.criticalTotal);
  const cc = sum((s) => s.criticalCorrect);
  const contraFixtures = scores.filter((s) => s.contradictionExpected);
  const contraDetected = contraFixtures.filter((s) => s.contradictionDetected).length;

  const n = scores.length || 1;
  return {
    fixtures: scores.length,
    fieldPrecision: pp ? tp / pp : 1,
    fieldRecall: pe ? tp / pe : 1,
    criticalFieldAccuracy: ct ? cc / ct : 1,
    hallucinationCount: sum((s) => s.hallucinations),
    contradictionRecall: contraFixtures.length ? contraDetected / contraFixtures.length : 1,
    falsePassRate: scores.filter((s) => s.falsePass).length / n,
    manualReviewRate: scores.filter((s) => s.needsManualReview).length / n,
  };
}

/** Release thresholds. The harness FAILS if a live-model run misses any of these. */
export const THRESHOLDS = {
  minFieldPrecision: 0.8,
  minFieldRecall: 0.7,
  minCriticalFieldAccuracy: 0.9,
  minContradictionRecall: 0.9,
  maxFalsePassRate: 0.05,
  maxHallucinations: 0,
} as const;

export interface ThresholdCheck {
  passed: boolean;
  failures: string[];
}

export function checkThresholds(m: AggregateMetrics): ThresholdCheck {
  const failures: string[] = [];
  if (m.fieldPrecision < THRESHOLDS.minFieldPrecision) failures.push(`fieldPrecision ${m.fieldPrecision.toFixed(2)} < ${THRESHOLDS.minFieldPrecision}`);
  if (m.fieldRecall < THRESHOLDS.minFieldRecall) failures.push(`fieldRecall ${m.fieldRecall.toFixed(2)} < ${THRESHOLDS.minFieldRecall}`);
  if (m.criticalFieldAccuracy < THRESHOLDS.minCriticalFieldAccuracy) failures.push(`criticalFieldAccuracy ${m.criticalFieldAccuracy.toFixed(2)} < ${THRESHOLDS.minCriticalFieldAccuracy}`);
  if (m.contradictionRecall < THRESHOLDS.minContradictionRecall) failures.push(`contradictionRecall ${m.contradictionRecall.toFixed(2)} < ${THRESHOLDS.minContradictionRecall}`);
  if (m.falsePassRate > THRESHOLDS.maxFalsePassRate) failures.push(`falsePassRate ${m.falsePassRate.toFixed(2)} > ${THRESHOLDS.maxFalsePassRate}`);
  if (m.hallucinationCount > THRESHOLDS.maxHallucinations) failures.push(`hallucinations ${m.hallucinationCount} > ${THRESHOLDS.maxHallucinations}`);
  return { passed: failures.length === 0, failures };
}
