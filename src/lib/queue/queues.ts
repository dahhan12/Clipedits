import { Queue } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";

/**
 * Named queues, one per pipeline stage. Job ids are set to deterministic keys
 * by callers so retries/duplicate enqueues collapse to a single job.
 */

export const QUEUE_NAMES = {
  discovery: "discovery",
  parse: "parse",
  ingest: "ingest",
  transcribe: "transcribe",
  clip: "clip",
  render: "render",
  compliance: "compliance",
  publish: "publish",
  submit: "submit",
  track: "track",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

function makeQueue(name: QueueName): Queue {
  return new Queue(name, { connection: redisConnection, defaultJobOptions });
}

export const discoveryQueue = makeQueue(QUEUE_NAMES.discovery);
export const parseQueue = makeQueue(QUEUE_NAMES.parse);

/** Enqueue a parse job idempotently keyed on the campaign id. */
export async function enqueueParse(campaignId: string): Promise<void> {
  await parseQueue.add(
    "parse-campaign",
    { campaignId },
    { jobId: `parse:${campaignId}` },
  );
}
