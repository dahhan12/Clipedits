import { prisma } from "@/lib/db/prisma";
import {
  discoveryQueue,
  parseQueue,
  ingestQueue,
  transcribeQueue,
  clipQueue,
  renderQueue,
  complianceQueue,
  publishQueue,
  submitQueue,
  trackQueue,
} from "@/lib/queue/queues";
import type { Queue } from "bullmq";

/**
 * Operational metrics for the dashboard: queue depths, job-run outcomes, and the
 * pipeline funnel. Read-only and defensive (returns empty shapes if the backing
 * store is unreachable) so the observability page never crashes.
 */

const ALL_QUEUES: Queue[] = [
  discoveryQueue,
  parseQueue,
  ingestQueue,
  transcribeQueue,
  clipQueue,
  renderQueue,
  complianceQueue,
  publishQueue,
  submitQueue,
  trackQueue,
];

export interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export async function getQueueDepths(): Promise<QueueDepth[]> {
  const out: QueueDepth[] = [];
  for (const q of ALL_QUEUES) {
    try {
      const c = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      out.push({
        name: q.name,
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
      });
    } catch {
      out.push({ name: q.name, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 });
    }
  }
  return out;
}

export interface JobRunStat {
  queue: string;
  status: string;
  count: number;
}

export async function getJobRunStats(): Promise<JobRunStat[]> {
  try {
    const rows = await prisma.jobRun.groupBy({ by: ["queue", "status"], _count: { _all: true } });
    return rows.map((r) => ({ queue: r.queue, status: r.status, count: r._count._all }));
  } catch {
    return [];
  }
}

export interface PipelineFunnel {
  campaigns: number;
  needsReview: number;
  assets: number;
  candidates: number;
  rendered: number;
  publications: number;
  submissions: number;
  failedJobs: number;
}

export async function getPipelineFunnel(): Promise<PipelineFunnel> {
  try {
    const [campaigns, needsReview, assets, candidates, rendered, publications, submissions, failedJobs] =
      await Promise.all([
        prisma.campaign.count(),
        prisma.campaign.count({ where: { status: "NEEDS_MANUAL_REVIEW" } }),
        prisma.sourceAsset.count(),
        prisma.clipCandidate.count(),
        prisma.renderedClip.count(),
        prisma.publication.count(),
        prisma.campaignSubmission.count(),
        prisma.jobRun.count({ where: { status: "FAILED" } }),
      ]);
    return { campaigns, needsReview, assets, candidates, rendered, publications, submissions, failedJobs };
  } catch {
    return { campaigns: 0, needsReview: 0, assets: 0, candidates: 0, rendered: 0, publications: 0, submissions: 0, failedJobs: 0 };
  }
}
