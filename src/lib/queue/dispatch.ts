import {
  discoveryQueue,
  enqueueParse,
  enqueueIngest,
  enqueueTranscribe,
  enqueueClip,
  enqueueRender,
  enqueueCompliance,
  enqueuePublish,
  enqueueSubmission,
  enqueueTracking,
} from "@/lib/queue/queues";

/**
 * Map a persisted (queue, jobKey) back to its enqueue call. Shared by the
 * manual retry route and the dead-letter replay service so both re-enter the
 * pipeline through the same idempotent enqueue helpers.
 */
export async function dispatchJob(queue: string, jobKey: string): Promise<void> {
  const [, ...rest] = jobKey.split(":");
  const id = rest.join(":");
  switch (queue) {
    case "discovery":
      await discoveryQueue.add("run", {}, { jobId: `discovery__${Date.now()}` });
      return;
    case "parse":
      return enqueueParse(id);
    case "ingest":
      return enqueueIngest(id);
    case "transcribe":
      return enqueueTranscribe(id);
    case "clip":
      return enqueueClip(id);
    case "render":
      return enqueueRender(id);
    case "compliance":
      return enqueueCompliance(id);
    case "publish": {
      const [renderedClipId, platform, mode] = rest;
      if (!renderedClipId || !platform || !mode) throw new Error("Bad publish jobKey");
      return enqueuePublish({ renderedClipId, platform, mode });
    }
    case "submit":
      return enqueueSubmission(id);
    case "track":
      return enqueueTracking(id);
    default:
      throw new Error(`Unknown queue: ${queue}`);
  }
}
