import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { getAccessToken } from "@/services/publishing/oauthService";
import { TikTokProvider } from "@/adapters/publishing/tiktok";
import { InstagramReelsProvider } from "@/adapters/publishing/instagram";
import { YouTubeShortsProvider } from "@/adapters/publishing/youtube";
import type { PublishProvider } from "@/adapters/publishing/types";
import { enqueueEarningsSync } from "@/lib/queue/queues";
import type { Platform } from "@/generated/prisma";

const PROVIDERS: Record<Platform, PublishProvider> = {
  TIKTOK: new TikTokProvider(),
  INSTAGRAM_REELS: new InstagramReelsProvider(),
  YOUTUBE_SHORTS: new YouTubeShortsProvider(),
};

/**
 * Sync a published post's platform metrics into a PostMetric snapshot. Metrics
 * are fetched from the provider's analytics API (null when no analytics token —
 * never fabricated). When a submission exists, an earnings sync is enqueued.
 */
export async function syncMetrics(publicationId: string): Promise<void> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    include: { submission: true },
  });
  if (!publication?.externalPostId) {
    logger.info({ publicationId }, "syncMetrics: no external post id; skipping");
    return;
  }

  const token = publication.accountId ? (await getAccessToken(publication.accountId)) ?? undefined : undefined;
  const metrics = await PROVIDERS[publication.platform].getMetrics(publication.externalPostId, token);

  // "Qualified views" default to raw views until a campaign-specific rule refines it.
  const qualifiedViews = metrics?.views ?? null;

  await prisma.postMetric.create({
    data: {
      publicationId,
      views: metrics?.views ?? null,
      likes: metrics?.likes ?? null,
      comments: metrics?.comments ?? null,
      shares: metrics?.shares ?? null,
      qualifiedViews,
    },
  });

  await audit({
    action: "publication.metrics.synced",
    entityType: "Publication",
    entityId: publicationId,
    metadata: { views: metrics?.views ?? null },
  });

  if (publication.submission) await enqueueEarningsSync(publication.submission.id);
  logger.info({ publicationId, views: metrics?.views ?? null }, "Metrics synced");
}
