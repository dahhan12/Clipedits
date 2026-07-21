import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import {
  deriveProvisionalPermission,
  checkPermission,
  assertRenderPermitted,
  verifyPermission,
} from "@/services/rights/permissionService";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const campaignIds: string[] = [];

async function assetWithRules(permitted: boolean) {
  const c = await prisma.campaign.create({
    data: { source: "MANUAL", externalId: `rights-${Math.random().toString(36).slice(2)}`, sourceUrl: "https://example.com/discover/r", status: "PARSED" },
  });
  campaignIds.push(c.id);
  const asset = await prisma.sourceAsset.create({
    data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id), status: "READY" },
  });
  const rules = CampaignRulesSchema.parse({
    campaignId: c.externalId,
    sourceUrl: c.sourceUrl,
    confidence: 0.95,
    supportedPlatforms: ["TIKTOK"],
  });
  await deriveProvisionalPermission({ sourceAssetId: asset.id, campaignRevisionId: null, permitted, rules });
  return asset;
}

afterAll(async () => {
  if (!hasDb) return;
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.$disconnect();
});

d("rights & provenance (integration)", () => {
  it("provisional (unverified) permission is REVIEW, never PASS", async () => {
    const asset = await assetWithRules(true);
    const c = await checkPermission(asset.id, ["DOWNLOAD", "CLIP", "MODIFY"], "TIKTOK");
    expect(c.outcome).toBe("REVIEW");
  });

  it("verifying the permission turns it into PASS", async () => {
    const asset = await assetWithRules(true);
    const perm = await prisma.assetPermission.findFirst({ where: { sourceAssetId: asset.id } });
    await verifyPermission(perm!.id, "tester");
    const c = await checkPermission(asset.id, ["DOWNLOAD", "CLIP", "MODIFY"], "TIKTOK");
    expect(c.outcome).toBe("PASS");
  });

  it("an unpermitted resource is DENIED and blocks rendering", async () => {
    const asset = await assetWithRules(false);
    const c = await checkPermission(asset.id, ["DOWNLOAD", "CLIP", "MODIFY"]);
    expect(c.outcome).toBe("FAIL");
    await expect(assertRenderPermitted(asset.id)).rejects.toThrow();
  });

  it("no permission record at all is REVIEW (unknown, not PASS)", async () => {
    const c = await prisma.campaign.create({
      data: { source: "MANUAL", externalId: `rights2-${Math.random().toString(36).slice(2)}`, sourceUrl: "https://example.com/discover/r2", status: "PARSED" },
    });
    campaignIds.push(c.id);
    const asset = await prisma.sourceAsset.create({ data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id + "b"), status: "READY" } });
    const check = await checkPermission(asset.id, ["DOWNLOAD"]);
    expect(check.outcome).toBe("REVIEW");
  });
});
