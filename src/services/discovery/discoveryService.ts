import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { enqueueParse } from "@/lib/queue/queues";
import type { DiscoveryAdapter } from "@/adapters/discovery/types";
import type { DiscoveredCampaign } from "@/lib/schemas/campaign";
import type { CampaignSource } from "@/generated/prisma";

export interface DiscoverySummary {
  discovered: number;
  created: number;
  revised: number;
  unchanged: number;
}

/**
 * Runs discovery adapters and persists results idempotently.
 *
 * - Campaigns are upserted on `(source, externalId)`.
 * - A `CampaignRevision` is written only when the page hash changed
 *   (deduped on `(campaignId, pageHash)`), which is how budget/status/
 *   requirement drift is detected.
 * - New or revised campaigns get a `parse` job enqueued (idempotent job id).
 */
export async function runDiscovery(
  adapters: DiscoveryAdapter[],
): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = { discovered: 0, created: 0, revised: 0, unchanged: 0 };

  for (const adapter of adapters) {
    let found: DiscoveredCampaign[] = [];
    try {
      found = await adapter.discover();
    } catch (err) {
      logger.error({ err, adapter: adapter.name }, "Discovery adapter failed");
      continue;
    }
    summary.discovered += found.length;

    for (const c of found) {
      const changed = await upsertDiscovered(c);
      if (changed === "created") summary.created += 1;
      else if (changed === "revised") summary.revised += 1;
      else summary.unchanged += 1;
    }
  }

  logger.info(summary, "Discovery run complete");
  return summary;
}

async function upsertDiscovered(
  c: DiscoveredCampaign,
): Promise<"created" | "revised" | "unchanged"> {
  const existing = await prisma.campaign.findUnique({
    where: { source_externalId: { source: c.source as CampaignSource, externalId: c.externalId } },
  });

  const campaign = await prisma.campaign.upsert({
    where: { source_externalId: { source: c.source as CampaignSource, externalId: c.externalId } },
    create: {
      source: c.source as CampaignSource,
      externalId: c.externalId,
      title: c.title,
      sourceUrl: c.sourceUrl,
      lastPageHash: c.pageHash,
    },
    update: { title: c.title ?? undefined, lastPageHash: c.pageHash },
  });

  // Revision is deduped on (campaignId, pageHash): retries never double-write.
  const revision = await prisma.campaignRevision.upsert({
    where: { campaignId_pageHash: { campaignId: campaign.id, pageHash: c.pageHash } },
    create: {
      campaignId: campaign.id,
      pageHash: c.pageHash,
      budgetTotal: c.budgetTotal ?? null,
      budgetRemaining: c.budgetRemaining ?? null,
      status: c.status ?? null,
    },
    update: {},
    select: { id: true, capturedAt: true },
  });

  const isNew = !existing;
  const isRevised = !isNew && existing.lastPageHash !== c.pageHash;

  if (isNew || isRevised) {
    await audit({
      action: isNew ? "campaign.discovered" : "campaign.revised",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { source: c.source, externalId: c.externalId, revisionId: revision.id },
    });
    await enqueueParse(campaign.id);
    return isNew ? "created" : "revised";
  }
  return "unchanged";
}
