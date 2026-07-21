import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { assertSafeUrl } from "@/lib/security/url";
import { objectStore } from "@/adapters/storage/objectStore";
import { resolveTargets } from "@/adapters/ingestion/resolvers";
import { enqueueTranscribe } from "@/lib/queue/queues";

/** Content types we accept for a downloaded source asset. */
const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mpeg",
  "application/octet-stream", // Drive/Dropbox often serve this for videos
];
const ALLOWED_EXT = /\.(mp4|mov|webm|m4v|mpeg|mpg)(\?|$)/i;

export interface IngestSummary {
  downloaded: number;
  skipped: number;
  failed: number;
}

/**
 * Download every permitted resource of a campaign into object storage as
 * SourceAssets. Never downloads from unapproved sources (`permitted === false`)
 * and always SSRF-guards the resolved URL. Persistence is idempotent on
 * (campaignId, checksum).
 */
export async function ingestCampaignResources(campaignId: string): Promise<IngestSummary> {
  const summary: IngestSummary = { downloaded: 0, skipped: 0, failed: 0 };
  const resources = await prisma.campaignResource.findMany({ where: { campaignId } });

  for (const resource of resources) {
    if (!resource.permitted) {
      summary.skipped += 1;
      logger.info({ resourceId: resource.id }, "Skipping unapproved resource");
      continue;
    }

    const targets = resolveTargets(resource.url, resource.kind);
    for (const target of targets) {
      if (!target.directUrl) {
        summary.skipped += 1;
        await prisma.campaignResource.update({
          where: { id: resource.id },
          data: { status: "DISCOVERED", notes: target.note ?? resource.notes },
        });
        logger.info({ resourceId: resource.id, extractor: target.requiresExtractor }, "Resource needs external extractor; skipped");
        continue;
      }

      try {
        const asset = await downloadOne({
          campaignId,
          resourceId: resource.id,
          directUrl: target.directUrl,
          filename: target.filename,
          originalSource: resource.url,
        });
        summary.downloaded += 1;
        await prisma.campaignResource.update({ where: { id: resource.id }, data: { status: "DOWNLOADED" } });
        if (asset) await enqueueTranscribe(asset.id);
      } catch (err) {
        summary.failed += 1;
        await prisma.campaignResource.update({ where: { id: resource.id }, data: { status: "FAILED" } });
        logger.error({ err, resourceId: resource.id }, "Resource download failed");
      }
    }
  }

  await audit({ action: "campaign.resources.ingested", entityType: "Campaign", entityId: campaignId, metadata: { ...summary } });
  return summary;
}

async function downloadOne(input: {
  campaignId: string;
  resourceId: string;
  directUrl: string;
  filename: string;
  originalSource: string;
}): Promise<{ id: string } | null> {
  await assertSafeUrl(input.directUrl);

  const resp = await fetch(input.directUrl, { redirect: "follow" });
  if (!resp.ok || !resp.body) {
    throw new Error(`Fetch failed: ${resp.status}`);
  }

  const contentType = (resp.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLength = Number(resp.headers.get("content-length") ?? "0");
  if (contentLength && contentLength > env.DOWNLOAD_MAX_BYTES) {
    throw new Error(`Declared size ${contentLength} exceeds cap ${env.DOWNLOAD_MAX_BYTES}`);
  }
  const typeOk = ALLOWED_CONTENT_TYPES.includes(contentType) || ALLOWED_EXT.test(input.filename);
  if (!typeOk) {
    throw new Error(`Disallowed content type "${contentType}" for ${input.filename}`);
  }

  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > env.DOWNLOAD_MAX_BYTES) {
        cb(new Error(`Download exceeded max size ${env.DOWNLOAD_MAX_BYTES} bytes`));
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  const storageKey = `campaigns/${input.campaignId}/resources/${input.resourceId}/${input.filename}`;
  const source = Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0]);
  await objectStore().putStream(storageKey, source.pipe(meter), contentType || undefined);

  const checksum = hash.digest("hex");

  const existing = await prisma.sourceAsset.findUnique({
    where: { campaignId_checksum: { campaignId: input.campaignId, checksum } },
  });
  if (existing) {
    logger.info({ checksum }, "Identical asset already present; idempotent skip");
    return existing;
  }

  const asset = await prisma.sourceAsset.create({
    data: {
      campaignId: input.campaignId,
      resourceId: input.resourceId,
      originalSource: input.originalSource,
      storageKey,
      checksum,
      mimeType: contentType || null,
      bytes,
      status: "READY",
      downloadedAt: new Date(),
    },
  });
  logger.info({ assetId: asset.id, bytes }, "Source asset downloaded");
  return asset;
}
