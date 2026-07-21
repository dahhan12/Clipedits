import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { ensureLocalFile } from "@/adapters/storage/objectStore";
import { RenderManifestSchema } from "@/lib/schemas/render";
import { getAccessToken } from "./oauthService";
import { TikTokProvider } from "@/adapters/publishing/tiktok";
import { InstagramReelsProvider } from "@/adapters/publishing/instagram";
import { YouTubeShortsProvider } from "@/adapters/publishing/youtube";
import type { PublishProvider } from "@/adapters/publishing/types";
import { enqueueSubmission } from "@/lib/queue/queues";
import { transition } from "@/lib/db/guardedTransition";
import { computeCapabilities } from "./capabilityService";
import { latestApprovedReview, reviewCoversCurrentFindings } from "./prePublicationService";
import { isHalted } from "@/services/ops/killSwitch";
import { getBudgetStatus, recordUsage } from "@/services/ops/costService";
import { applyCampaignStopConditions } from "@/services/ops/campaignStopConditions";
import type { Platform, PublicationMode } from "@/generated/prisma";

const PROVIDERS: Record<Platform, PublishProvider> = {
  TIKTOK: new TikTokProvider(),
  INSTAGRAM_REELS: new InstagramReelsProvider(),
  YOUTUBE_SHORTS: new YouTubeShortsProvider(),
};

export interface PublishRequest {
  renderedClipId: string;
  platform: Platform;
  mode: PublicationMode;
}

/**
 * Publish (or prepare) a rendered clip for a platform.
 *
 * Guarantees:
 *  - blocked if any compliance check FAILed;
 *  - AUTO is downgraded to DRAFT when compliance has REVIEWs or when the clip
 *    requires official in-app audio/stickers/effects;
 *  - idempotent on (renderedClipId, platform, idempotencyKey) so a retried job
 *    never double-posts;
 *  - the official API is used when the account is connected; otherwise a local
 *    DRAFT is prepared (never browser-automated posting, never a faked post).
 */
export async function publishClip(req: PublishRequest): Promise<{ publicationId: string; status: string }> {
  const rendered = await prisma.renderedClip.findUnique({
    where: { id: req.renderedClipId },
    include: { compliance: true, candidate: { include: { sourceAsset: { include: { campaign: true } } } } },
  });
  if (!rendered?.storageKey) throw new Error("Rendered clip not found or missing storage key");

  const campaign = rendered.candidate.sourceAsset.campaign;

  // Global kill switch + spend cap: refuse (never fabricate a post) before any
  // provider call when publishing is halted or the daily cost cap is reached.
  if (await isHalted("publishing")) return skip(req, "Blocked: publishing halted by kill switch");
  const budget = await getBudgetStatus(campaign.workspaceId);
  if (!budget.allowed) return skip(req, `Blocked: ${budget.reason}`);

  const gate = complianceGate(rendered.compliance);
  const manifest = RenderManifestSchema.safeParse(rendered.renderManifest);
  const requiresInApp = manifest.success && manifest.data.requiresInAppAudioOrEffects;

  // Effective mode: force away from AUTO when unsafe.
  let mode: PublicationMode = req.mode;
  const downgradeReasons: string[] = [];
  if (gate.hasFail) {
    return skip(req, "Blocked: a compliance check FAILed");
  }

  const caption = manifest.success ? manifest.data.captions[platformKey(req.platform)] ?? "" : "";
  const account = await prisma.socialAccount.findFirst({
    where: { platform: req.platform, active: true },
  });

  // An audited operator override (approved pre-publication review) can waive
  // REVIEW findings so AUTO may proceed. FAIL and safety-critical REVIEWs are
  // never waivable — reviewCoversCurrentFindings enforces that.
  const findings = rendered.compliance.map((c) => ({ check: c.check, outcome: c.outcome }));
  const approvedReview = gate.hasReview ? await latestApprovedReview(req.renderedClipId, req.platform) : null;
  const reviewWaivesReview = reviewCoversCurrentFindings(approvedReview, findings);
  const effectiveComplianceOutcome: "PASS" | "REVIEW" = gate.hasReview && !reviewWaivesReview ? "REVIEW" : "PASS";

  // Platform capability gating: never AUTO-publish when the provider/app cannot
  // actually perform a public post (unaudited app, unverified project, etc.).
  const capability = computeCapabilities({
    platform: req.platform,
    accountConnected: !!account,
    requiresInAppAudioOrEffects: requiresInApp,
    complianceOutcome: effectiveComplianceOutcome,
  });
  if (mode === "AUTO" && capability.maxMode !== "AUTO") {
    mode = "DRAFT";
    downgradeReasons.push(...capability.reasons);
  }
  const overrideId = reviewWaivesReview && approvedReview ? approvedReview.id : null;
  const accessToken = account ? (await getAccessToken(account.id)) ?? undefined : undefined;

  const idempotencyKey = `${mode}`;
  // Idempotent placeholder; a prior SUCCEEDED publication for this key is reused.
  const existing = await prisma.publication.findUnique({
    where: {
      renderedClipId_platform_idempotencyKey: {
        renderedClipId: req.renderedClipId,
        platform: req.platform,
        idempotencyKey,
      },
    },
  });
  if (existing && (existing.status === "PUBLISHED" || existing.status === "DRAFTED")) {
    logger.info({ publicationId: existing.id }, "Publication already exists; idempotent reuse");
    return { publicationId: existing.id, status: existing.status };
  }

  // Create the PENDING publication inside a transaction that re-checks, at the
  // last moment, that no compliance check FAILs — closing the gap between the
  // initial gate read and the write. The unique (clip, platform, idempotencyKey)
  // guarantees two concurrent workers cannot both create a publication.
  const publication = await prisma.$transaction(async (tx) => {
    const failCount = await tx.complianceResult.count({
      where: { renderedClipId: req.renderedClipId, outcome: "FAIL" },
    });
    if (failCount > 0) throw new ComplianceFailedError();
    return tx.publication.upsert({
      where: {
        renderedClipId_platform_idempotencyKey: {
          renderedClipId: req.renderedClipId,
          platform: req.platform,
          idempotencyKey,
        },
      },
      create: {
        renderedClipId: req.renderedClipId,
        accountId: account?.id,
        platform: req.platform,
        mode,
        status: "PENDING",
        idempotencyKey,
        captionText: caption,
      },
      update: { mode, status: "PENDING", captionText: caption, failureReason: null },
    });
  }).catch((err) => {
    if (err instanceof ComplianceFailedError) return null;
    throw err;
  });

  if (!publication) return skip(req, "Blocked: a compliance check FAILed");

  try {
    const localPath = await ensureLocalFile(rendered.storageKey);
    const clipUrl = `${env.APP_URL}/api/clips/${req.renderedClipId}/video`;
    const provider = PROVIDERS[req.platform];

    // MANUAL mode never pushes to the provider — operator posts by hand.
    const result =
      mode === "MANUAL"
        ? { status: "DRAFTED" as const, note: "MANUAL mode: operator will post; draft prepared." }
        : await provider.publish({
            localPath,
            clipUrl,
            caption,
            mode,
            accessToken,
            accountHandle: account?.externalId ?? account?.handle ?? "",
          });

    // Guarded, version-checked transition PENDING → result.status.
    await transition.publication(publication.id, result.status, {
      externalPostId: result.externalPostId,
      postUrl: result.postUrl,
    });

    await audit({
      action: "clip.published",
      entityType: "Publication",
      entityId: publication.id,
      metadata: { platform: req.platform, mode, status: result.status, downgradeReasons, overrideId, note: result.note },
    });

    await enqueueSubmission(publication.id);
    // Cost accounting + campaign stop conditions (best-effort; never fail the
    // publish on these). Pause the campaign if it has now hit its post cap /
    // budget / deadline so the pipeline stops producing for it.
    await recordUsage({ workspaceId: campaign.workspaceId, kind: "publish" });
    await applyCampaignStopConditions(campaign.id);
    logger.info({ publicationId: publication.id, status: result.status, mode }, "Publish complete");
    return { publicationId: publication.id, status: result.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await transition
      .publication(publication.id, "FAILED", { failureReason: msg })
      .catch((e) => logger.warn({ e, publicationId: publication.id }, "could not mark publication FAILED"));
    logger.error({ err, publicationId: publication.id }, "Publish failed");
    throw err;
  }
}

class ComplianceFailedError extends Error {}

function complianceGate(results: Array<{ outcome: string }>): { hasFail: boolean; hasReview: boolean } {
  return {
    hasFail: results.some((r) => r.outcome === "FAIL"),
    hasReview: results.some((r) => r.outcome === "REVIEW"),
  };
}

async function skip(req: PublishRequest, reason: string): Promise<{ publicationId: string; status: string }> {
  const pub = await prisma.publication.upsert({
    where: {
      renderedClipId_platform_idempotencyKey: {
        renderedClipId: req.renderedClipId,
        platform: req.platform,
        idempotencyKey: `${req.mode}`,
      },
    },
    create: {
      renderedClipId: req.renderedClipId,
      platform: req.platform,
      mode: req.mode,
      status: "SKIPPED",
      idempotencyKey: `${req.mode}`,
      failureReason: reason,
    },
    update: { status: "SKIPPED", failureReason: reason },
  });
  await audit({ action: "clip.publish.skipped", entityType: "Publication", entityId: pub.id, metadata: { reason } });
  logger.warn({ publicationId: pub.id, reason }, "Publish skipped");
  return { publicationId: pub.id, status: "SKIPPED" };
}

function platformKey(platform: Platform): "TIKTOK" | "INSTAGRAM_REELS" | "YOUTUBE_SHORTS" {
  return platform;
}
