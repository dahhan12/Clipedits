import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { utcToday } from "@/lib/time";
import { getGlobalDailyCapUsd } from "./killSwitch";

/**
 * Cost tracking + spend caps.
 *
 * Costs here are ESTIMATES, not billing figures — coarse per-operation rates
 * used only to power dashboards and to enforce soft daily caps. When a cap is
 * exceeded, expensive operations (render / AI / publish) are refused *before*
 * they spend, so a runaway loop cannot burn an unbounded amount.
 *
 * Shared-pool work (no workspace) is attributed to the SHARED_WORKSPACE sentinel
 * and governed by the global cap only.
 */

export const SHARED_WORKSPACE = "__shared__";

/** Coarse estimated unit rates (USD). Deliberately conservative/round. */
export const RATES = {
  aiCallUsd: 0.03, // per structured extraction / vision call
  renderPerSecUsd: 0.002, // per second of rendered output
  transcribePerSecUsd: 0.0001, // per second of audio transcribed
  publishUsd: 0.001, // per publish attempt (API overhead)
} as const;

export type UsageKind = "ai" | "render" | "transcribe" | "publish";

function wsKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? SHARED_WORKSPACE;
}

export interface UsageInput {
  workspaceId?: string | null;
  kind: UsageKind;
  /** Seconds for render/transcribe; count for ai/publish. */
  units?: number;
}

/** Estimated USD cost for a single usage event. */
export function estimateCostUsd(input: UsageInput): number {
  const units = input.units ?? 1;
  switch (input.kind) {
    case "ai":
      return RATES.aiCallUsd * units;
    case "render":
      return RATES.renderPerSecUsd * units;
    case "transcribe":
      return RATES.transcribePerSecUsd * units;
    case "publish":
      return RATES.publishUsd * units;
  }
}

/**
 * Record a usage event into the per-(workspace, day) aggregate. Never throws —
 * a metrics write failure must not break the pipeline.
 */
export async function recordUsage(input: UsageInput): Promise<void> {
  const cost = estimateCostUsd(input);
  const units = input.units ?? 1;
  const day = utcToday();
  const workspaceId = wsKey(input.workspaceId);
  const inc = {
    aiCalls: input.kind === "ai" ? 1 : 0,
    renderSeconds: input.kind === "render" ? units : 0,
    transcribeSeconds: input.kind === "transcribe" ? units : 0,
    publishCount: input.kind === "publish" ? 1 : 0,
  };
  try {
    await prisma.usageCounter.upsert({
      where: { workspaceId_day: { workspaceId, day } },
      create: {
        workspaceId,
        day,
        aiCalls: inc.aiCalls,
        renderSeconds: inc.renderSeconds,
        transcribeSeconds: inc.transcribeSeconds,
        publishCount: inc.publishCount,
        costUsd: cost,
      },
      update: {
        aiCalls: { increment: inc.aiCalls },
        renderSeconds: { increment: inc.renderSeconds },
        transcribeSeconds: { increment: inc.transcribeSeconds },
        publishCount: { increment: inc.publishCount },
        costUsd: { increment: cost },
      },
    });
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "recordUsage failed");
  }
}

export interface BudgetStatus {
  allowed: boolean;
  reason: string;
  spentUsd: number;
  capUsd: number | null;
}

/**
 * Today's spend + cap check for a workspace. The effective cap is the stricter
 * of the workspace cap and the global cap. Fails OPEN on a read error (returns
 * allowed) so a DB blip never wedges the pipeline — the cap is a soft guard, not
 * a correctness gate.
 */
export async function getBudgetStatus(workspaceId: string | null | undefined): Promise<BudgetStatus> {
  const day = utcToday();
  const wid = wsKey(workspaceId);
  try {
    const [row, globalCap, workspace] = await Promise.all([
      prisma.usageCounter.findUnique({ where: { workspaceId_day: { workspaceId: wid, day } } }),
      getGlobalDailyCapUsd(),
      workspaceId ? prisma.workspace.findUnique({ where: { id: workspaceId }, select: { dailyCostCapUsd: true } }) : Promise.resolve(null),
    ]);
    const spentUsd = row?.costUsd ?? 0;
    const caps = [globalCap, workspace?.dailyCostCapUsd ?? null].filter((c): c is number => c != null);
    const capUsd = caps.length ? Math.min(...caps) : null;
    if (capUsd == null) return { allowed: true, reason: "No cap set", spentUsd, capUsd: null };
    if (spentUsd >= capUsd) {
      return { allowed: false, reason: `Daily cost cap reached ($${spentUsd.toFixed(2)} ≥ $${capUsd.toFixed(2)})`, spentUsd, capUsd };
    }
    return { allowed: true, reason: `Within cap ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)})`, spentUsd, capUsd };
  } catch (err) {
    logger.warn({ err, workspaceId: wid }, "getBudgetStatus failed; failing open");
    return { allowed: true, reason: "Budget check unavailable (failing open)", spentUsd: 0, capUsd: null };
  }
}

export class BudgetExceededError extends Error {}

/** Throw BudgetExceededError when the workspace/global daily cap is reached. */
export async function assertWithinBudget(workspaceId: string | null | undefined): Promise<void> {
  const status = await getBudgetStatus(workspaceId);
  if (!status.allowed) throw new BudgetExceededError(status.reason);
}

export interface UsageSummaryRow {
  workspaceId: string;
  day: Date;
  aiCalls: number;
  renderSeconds: number;
  publishCount: number;
  costUsd: number;
}

/** Recent per-(workspace, day) usage rows for the ops dashboard. */
export async function getUsageSummary(days = 7): Promise<UsageSummaryRow[]> {
  const since = utcToday();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  try {
    const rows = await prisma.usageCounter.findMany({
      where: { day: { gte: since } },
      orderBy: [{ day: "desc" }, { costUsd: "desc" }],
    });
    return rows.map((r) => ({
      workspaceId: r.workspaceId,
      day: r.day,
      aiCalls: r.aiCalls,
      renderSeconds: r.renderSeconds,
      publishCount: r.publishCount,
      costUsd: r.costUsd,
    }));
  } catch (err) {
    logger.error({ err }, "getUsageSummary failed");
    return [];
  }
}
