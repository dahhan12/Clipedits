import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

/**
 * Per-provider API latency/error metrics.
 *
 * External calls (Anthropic, Whisper, R2, TikTok, Instagram, YouTube, Whop, the
 * Content Rewards portal) are wrapped in `recordProviderCall`, which times the
 * call and upserts an aggregate row keyed on (provider, operation, day). This is
 * deliberately an aggregate — not a per-call table — so it stays bounded and is
 * visible across the worker/web process boundary (workers write, the dashboard
 * reads).
 *
 * Recording never affects the wrapped call: a metrics write failure is logged
 * and swallowed.
 */

function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function record(
  provider: string,
  operation: string,
  ms: number,
  ok: boolean,
  errorMessage?: string,
): Promise<void> {
  const day = today();
  const durationMs = Math.max(0, Math.round(ms));
  try {
    await prisma.providerStat.upsert({
      where: { provider_operation_day: { provider, operation, day } },
      create: {
        provider,
        operation,
        day,
        calls: 1,
        errors: ok ? 0 : 1,
        totalMs: durationMs,
        maxMs: durationMs,
        lastError: ok ? null : errorMessage?.slice(0, 500),
        lastAt: new Date(),
      },
      update: {
        calls: { increment: 1 },
        errors: { increment: ok ? 0 : 1 },
        totalMs: { increment: durationMs },
        lastError: ok ? undefined : errorMessage?.slice(0, 500),
        lastAt: new Date(),
      },
    });
    // maxMs is a running max; upsert can't express GREATEST atomically, so raise
    // it in a separate cheap conditional write when this sample is a new high.
    await prisma.providerStat.updateMany({
      where: { provider, operation, day, maxMs: { lt: durationMs } },
      data: { maxMs: durationMs },
    });
  } catch (err) {
    logger.warn({ err, provider, operation }, "provider metric write failed");
  }
}

/**
 * Time and record an external provider call. Rethrows the original error after
 * recording it, so callers see identical behaviour to calling `fn` directly.
 */
export async function recordProviderCall<T>(
  provider: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    void record(provider, operation, Date.now() - start, true);
    return result;
  } catch (err) {
    void record(provider, operation, Date.now() - start, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export interface ProviderMetric {
  provider: string;
  operation: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  maxMs: number;
  lastError: string | null;
  lastAt: Date;
}

/** Aggregate provider metrics over the last `days` days (default 7). */
export async function getProviderMetrics(days = 7): Promise<ProviderMetric[]> {
  const since = today();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  try {
    const rows = await prisma.providerStat.groupBy({
      by: ["provider", "operation"],
      where: { day: { gte: since } },
      _sum: { calls: true, errors: true, totalMs: true },
      _max: { maxMs: true, lastAt: true },
    });
    const out: ProviderMetric[] = [];
    for (const r of rows) {
      const calls = r._sum.calls ?? 0;
      const errors = r._sum.errors ?? 0;
      const totalMs = r._sum.totalMs ?? 0;
      // Find the most recent lastError for this provider/operation.
      const latest = await prisma.providerStat.findFirst({
        where: { provider: r.provider, operation: r.operation, day: { gte: since }, lastError: { not: null } },
        orderBy: { lastAt: "desc" },
        select: { lastError: true },
      });
      out.push({
        provider: r.provider,
        operation: r.operation,
        calls,
        errors,
        errorRate: calls > 0 ? errors / calls : 0,
        avgMs: calls > 0 ? Math.round(totalMs / calls) : 0,
        maxMs: r._max.maxMs ?? 0,
        lastError: latest?.lastError ?? null,
        lastAt: r._max.lastAt ?? since,
      });
    }
    return out.sort((a, b) => b.errorRate - a.errorRate || b.calls - a.calls);
  } catch (err) {
    logger.error({ err }, "getProviderMetrics failed");
    return [];
  }
}
