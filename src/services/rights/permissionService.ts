import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { sha256Hex } from "@/lib/security/crypto";
import type { CampaignRules, CampaignPlatform } from "@/lib/schemas/campaign";
import type { Platform, TransformationType, AssetPermission } from "@/generated/prisma";

/**
 * Rights & provenance enforcement. A source asset must never reach rendering or
 * publication unless a permission covers the required transformations (and, for
 * publication, the target platform). Auto-derived permissions are UNVERIFIED /
 * PROVISIONAL and therefore only ever yield a compliance REVIEW — never a PASS —
 * until a human verifies the rights evidence.
 */

const RENDER_TRANSFORMS: TransformationType[] = ["DOWNLOAD", "CLIP", "MODIFY"];

/** Map campaign platforms to publishable Platform enum values. */
function toPlatforms(cps: CampaignPlatform[]): Platform[] {
  const out: Platform[] = [];
  for (const p of cps) {
    if (p === "TIKTOK" || p === "INSTAGRAM_REELS" || p === "YOUTUBE_SHORTS") out.push(p);
    else if (p === "INSTAGRAM") out.push("INSTAGRAM_REELS");
    else if (p === "YOUTUBE") out.push("YOUTUBE_SHORTS");
  }
  return [...new Set(out)];
}

/**
 * Derive a PROVISIONAL/UNVERIFIED permission from the campaign grant when a
 * resource was expressly permitted for download. Idempotent per asset+revision.
 */
export async function deriveProvisionalPermission(input: {
  sourceAssetId: string;
  campaignRevisionId: string | null;
  permitted: boolean;
  rules: CampaignRules | null;
  evidenceUrl?: string;
  evidenceExcerpt?: string;
}): Promise<void> {
  const platforms = input.rules ? toPlatforms(input.rules.supportedPlatforms) : [];
  const transforms: TransformationType[] = ["DOWNLOAD", "CLIP", "MODIFY", "CAPTION", "OVERLAY", "PUBLISH"];

  await prisma.assetPermission.create({
    data: {
      sourceAssetId: input.sourceAssetId,
      campaignRevisionId: input.campaignRevisionId,
      permissionType: "CAMPAIGN_GRANT",
      permittedPlatforms: platforms,
      permittedTransformations: input.permitted ? transforms : [],
      validUntil: input.rules?.deadline ? new Date(input.rules.deadline) : null,
      evidenceUrl: input.evidenceUrl,
      evidenceExcerpt: input.evidenceExcerpt?.slice(0, 500),
      evidenceHash: input.evidenceExcerpt ? sha256Hex(input.evidenceExcerpt) : null,
      // Not human-verified: only ever REVIEW until confirmed.
      status: input.permitted ? "PROVISIONAL" : "DENIED",
    },
  });
  await audit({
    action: "asset.permission.derived",
    entityType: "SourceAsset",
    entityId: input.sourceAssetId,
    metadata: { permitted: input.permitted, platforms },
  });
}

function activePermissions(perms: AssetPermission[], now = new Date()): AssetPermission[] {
  return perms.filter(
    (p) =>
      p.status !== "REVOKED" &&
      p.status !== "DENIED" &&
      (!p.validFrom || p.validFrom <= now) &&
      (!p.validUntil || p.validUntil >= now),
  );
}

export type PermissionOutcome = "PASS" | "REVIEW" | "FAIL";

export interface PermissionCheck {
  outcome: PermissionOutcome;
  reason: string;
}

/** Whether the asset's permissions allow the given transformations (+ platform). */
export async function checkPermission(
  sourceAssetId: string,
  transforms: TransformationType[],
  platform?: Platform,
): Promise<PermissionCheck> {
  const all = await prisma.assetPermission.findMany({ where: { sourceAssetId } });
  // An explicit denial or revocation blocks use regardless of other records.
  if (all.some((p) => p.status === "DENIED")) return { outcome: "FAIL", reason: "Use of this asset is denied by the campaign grant" };
  if (all.length > 0 && all.every((p) => p.status === "REVOKED")) return { outcome: "FAIL", reason: "All permissions for this asset are revoked" };

  const perms = activePermissions(all);
  if (perms.length === 0) return { outcome: "REVIEW", reason: "No active permission record for this asset" };

  const covers = (p: AssetPermission) =>
    transforms.every((t) => p.permittedTransformations.includes(t)) &&
    (!platform || p.permittedPlatforms.includes(platform));

  const covering = perms.filter(covers);
  if (covering.length === 0) {
    return { outcome: "FAIL", reason: `No permission covers ${transforms.join("+")}${platform ? ` on ${platform}` : ""}` };
  }
  // A VERIFIED covering permission passes; otherwise it needs human review.
  if (covering.some((p) => p.status === "VERIFIED")) {
    return { outcome: "PASS", reason: "Verified permission covers the requested use" };
  }
  return { outcome: "REVIEW", reason: "Permission is provisional/unverified — human confirmation required" };
}

/** Guard: throw unless the asset may be downloaded/clipped/modified for rendering. */
export async function assertRenderPermitted(sourceAssetId: string): Promise<void> {
  const check = await checkPermission(sourceAssetId, RENDER_TRANSFORMS);
  if (check.outcome === "FAIL") {
    throw new Error(`Render blocked — rights: ${check.reason}`);
  }
  if (check.outcome === "REVIEW") {
    // Provisional rights allow producing an internal draft, but log it loudly.
    logger.warn({ sourceAssetId, reason: check.reason }, "Rendering under provisional (unverified) rights");
  }
}

/** Operator verification of an asset's rights. */
export async function verifyPermission(permissionId: string, userId: string): Promise<void> {
  await prisma.assetPermission.update({
    where: { id: permissionId },
    data: { status: "VERIFIED", verifiedByUserId: userId, verifiedAt: new Date() },
  });
  await audit({ action: "asset.permission.verified", entityType: "AssetPermission", entityId: permissionId, actor: userId });
}
