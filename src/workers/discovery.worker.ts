import { Worker } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { ContentRewardsDiscoverAdapter } from "@/adapters/discovery/contentRewards";
import { WhopForumAdapter } from "@/adapters/discovery/whopForum";
import { runDiscovery } from "@/services/discovery/discoveryService";
import { parseAndPersist } from "@/services/parsing/parseService";
import { withJobRun } from "./jobRun";
import { registerGracefulShutdown } from "./shutdown";
import { attachWorkerObservability } from "./deadLetter";
import { logger } from "@/lib/logging/logger";
import { validateDeploymentEnv } from "@/lib/config/deployEnv";

validateDeploymentEnv();

/**
 * Two workers in one process:
 *  - discovery: runs both adapters and persists idempotently.
 *  - parse: parses a single campaign into validated rules.
 *
 * Run with `npm run worker:discovery`.
 */

const discoveryWorker = new Worker(
  QUEUE_NAMES.discovery,
  async () =>
    withJobRun(QUEUE_NAMES.discovery, "run", {}, () =>
      runDiscovery([new ContentRewardsDiscoverAdapter(), new WhopForumAdapter()]),
    ),
  { connection: redisConnection, concurrency: 1 },
);

const parseWorker = new Worker(
  QUEUE_NAMES.parse,
  async (job) => {
    const campaignId = job.data.campaignId as string;
    return withJobRun(QUEUE_NAMES.parse, `parse:${campaignId}`, { campaignId }, () =>
      parseAndPersist(campaignId),
    );
  },
  { connection: redisConnection, concurrency: 3 },
);

attachWorkerObservability([
  ["discovery", discoveryWorker],
  ["parse", parseWorker],
]);

logger.info("Discovery + parse workers started");

registerGracefulShutdown([discoveryWorker, parseWorker]);
