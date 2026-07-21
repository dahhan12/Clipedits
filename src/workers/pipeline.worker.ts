import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { withJobRun } from "./jobRun";
import { registerGracefulShutdown } from "./shutdown";
import { ingestCampaignResources } from "@/services/ingestion/downloadService";
import { transcribeAsset } from "@/services/pipeline/transcribeService";
import { generateClipCandidates } from "@/services/pipeline/clipCandidateService";
import { logger } from "@/lib/logging/logger";
import { validateDeploymentEnv } from "@/lib/config/deployEnv";

validateDeploymentEnv();

/**
 * Phase 2 pipeline workers: ingest → transcribe → clip. Each job is wrapped in
 * an idempotent JobRun so retries never re-download or re-clip. Run with
 * `npm run worker:pipeline`.
 */

const ingestWorker = new Worker(
  QUEUE_NAMES.ingest,
  async (job) => {
    const campaignId = job.data.campaignId as string;
    return withJobRun(QUEUE_NAMES.ingest, `ingest:${campaignId}`, { campaignId }, () =>
      ingestCampaignResources(campaignId),
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

const transcribeWorker = new Worker(
  QUEUE_NAMES.transcribe,
  async (job) => {
    const assetId = job.data.assetId as string;
    return withJobRun(QUEUE_NAMES.transcribe, `transcribe:${assetId}`, { assetId }, () =>
      transcribeAsset(assetId),
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

const clipWorker = new Worker(
  QUEUE_NAMES.clip,
  async (job) => {
    const assetId = job.data.assetId as string;
    return withJobRun(QUEUE_NAMES.clip, `clip:${assetId}`, { assetId }, () =>
      generateClipCandidates(assetId),
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

for (const [name, w] of [
  ["ingest", ingestWorker],
  ["transcribe", transcribeWorker],
  ["clip", clipWorker],
] as const) {
  w.on("completed", (job) => logger.info({ worker: name, jobId: job.id }, "job completed"));
  w.on("failed", (job, err) => logger.error({ worker: name, jobId: job?.id, err }, "job failed"));
}

logger.info("Pipeline workers (ingest, transcribe, clip) started");

registerGracefulShutdown([ingestWorker, transcribeWorker, clipWorker]);
