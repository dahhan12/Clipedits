import type { CampaignRules, CampaignPlatform } from "@/lib/schemas/campaign";
import { CONFIDENCE_ASSETS } from "@/lib/schemas/campaign";

/**
 * Campaign profitability & priority scoring (per spec). Pure and unit-tested.
 *
 *   estimatedRevenue = expectedQualifiedViews × effectiveCPM ÷ 1000
 *   estimatedProfit  = estimatedRevenue − processingCost − publishingCost
 *                      − estimatedRejectionLoss
 *   priorityScore    = estimatedProfit × confidence × remainingBudgetFactor
 *                      × timeRemainingFactor
 */

export interface CostModel {
  processingCost: number;
  publishingCost: number;
  /** Fraction (0..1) of revenue expected to be lost to rejections. */
  rejectionLossRate: number;
}

export const DEFAULT_COSTS: CostModel = {
  processingCost: 0.5,
  publishingCost: 0.1,
  rejectionLossRate: 0.2,
};

/** Average CPM across the campaign's supported platforms (or all listed). */
export function effectiveCpm(rules: CampaignRules): number {
  const platforms: CampaignPlatform[] = rules.supportedPlatforms.length
    ? rules.supportedPlatforms
    : (Object.keys(rules.cpmByPlatform) as CampaignPlatform[]);
  const values = platforms
    .map((p) => rules.cpmByPlatform[p])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 0..1 factor from remaining budget (0 when depleted, 0.5 when unknown). */
export function remainingBudgetFactor(rules: CampaignRules): number {
  const rem = rules.budgetRemaining;
  if (rem == null) return 0.5;
  if (rem <= 0) return 0;
  const total = rules.budgetTotal ?? rem;
  return Math.max(0, Math.min(1, rem / total));
}

/** 0..1 factor from time remaining (0 past deadline, 0.5 when unknown). */
export function timeRemainingFactor(rules: CampaignRules, now = new Date()): number {
  const iso = rules.deadline ?? rules.campaignEndDate;
  if (!iso) return 0.5;
  const dl = new Date(iso).getTime();
  if (Number.isNaN(dl)) return 0.5;
  const days = (dl - now.getTime()) / 86_400_000;
  if (days <= 0) return 0;
  return Math.max(0, Math.min(1, days / 30));
}

export interface Profitability {
  expectedQualifiedViews: number;
  effectiveCpm: number;
  estimatedRevenue: number;
  estimatedProfit: number;
  priorityScore: number;
}

export function scoreCampaign(
  rules: CampaignRules,
  opts: { expectedQualifiedViews?: number; costs?: CostModel; now?: Date } = {},
): Profitability {
  const costs = opts.costs ?? DEFAULT_COSTS;
  const cpm = effectiveCpm(rules);
  const expectedQualifiedViews = opts.expectedQualifiedViews ?? rules.minViews ?? 10_000;

  const estimatedRevenue = (expectedQualifiedViews * cpm) / 1000;
  const estimatedProfit =
    estimatedRevenue - costs.processingCost - costs.publishingCost - estimatedRevenue * costs.rejectionLossRate;

  const priorityScore =
    estimatedProfit * rules.confidence * remainingBudgetFactor(rules) * timeRemainingFactor(rules, opts.now);

  return {
    expectedQualifiedViews,
    effectiveCpm: Number(cpm.toFixed(3)),
    estimatedRevenue: Number(estimatedRevenue.toFixed(2)),
    estimatedProfit: Number(estimatedProfit.toFixed(2)),
    priorityScore: Number(priorityScore.toFixed(2)),
  };
}

export interface ProcessDecision {
  process: boolean;
  reasons: string[];
}

/** Whether to spend expensive processing on a campaign, with stop reasons. */
export function shouldProcess(
  rules: CampaignRules,
  campaignStatus: string,
  opts: { accountEligible?: boolean; expectedQualifiedViews?: number; costs?: CostModel; now?: Date } = {},
): ProcessDecision {
  const reasons: string[] = [];
  if (["CLOSED", "PAUSED", "ERROR"].includes(campaignStatus)) reasons.push(`campaign is ${campaignStatus}`);
  if (remainingBudgetFactor(rules) === 0) reasons.push("remaining budget is depleted");
  if (rules.uncertainties.length > 0) reasons.push("rules are unclear/contradictory");
  if (rules.confidence < CONFIDENCE_ASSETS) reasons.push("confidence below processing threshold");
  if (opts.accountEligible === false) reasons.push("account is ineligible");

  const { estimatedProfit } = scoreCampaign(rules, opts);
  if (estimatedProfit <= 0) reasons.push("expected processing cost exceeds expected profit");

  return { process: reasons.length === 0, reasons };
}
