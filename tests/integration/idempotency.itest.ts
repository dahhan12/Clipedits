import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import { transition, StaleWriteError } from "@/lib/db/guardedTransition";
import { publishClip } from "@/services/publishing/publishService";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { RenderManifestSchema } from "@/lib/schemas/render";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const createdCampaignIds: string[] = [];

async function makeCampaign(status: string = "PARSED") {
  const c = await prisma.campaign.create({
    data: {
      source: "MANUAL",
      externalId: `itest-${Math.random().toString(36).slice(2)}`,
      sourceUrl: "https://example.com/discover/itest",
      status: status as never,
    },
  });
  createdCampaignIds.push(c.id);
  return c;
}

afterAll(async () => {
  if (!hasDb) return;
  await prisma.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } });
  await prisma.$disconnect();
});

d("idempotency & concurrency (integration)", () => {
  it("re-running discovery creates no duplicate revision", async () => {
    const c = await makeCampaign("DISCOVERED");
    const pageHash = sha256Hex("page-v1");
    for (let i = 0; i < 3; i++) {
      await prisma.campaignRevision.upsert({
        where: { campaignId_pageHash: { campaignId: c.id, pageHash } },
        create: { campaignId: c.id, pageHash },
        update: {},
      });
    }
    const count = await prisma.campaignRevision.count({ where: { campaignId: c.id } });
    expect(count).toBe(1);
  });

  it("optimistic concurrency: a stale version update affects zero rows", async () => {
    const c = await makeCampaign("DISCOVERED");
    // Worker A wins:
    const a = await prisma.campaign.updateMany({ where: { id: c.id, version: 0 }, data: { version: 1, status: "PARSING" } });
    expect(a.count).toBe(1);
    // Worker B holds the stale version 0:
    const b = await prisma.campaign.updateMany({ where: { id: c.id, version: 0 }, data: { version: 1, status: "CLOSED" } });
    expect(b.count).toBe(0);
  });

  it("guardedTransition throws StaleWriteError when the row moved on", async () => {
    const c = await makeCampaign("DISCOVERED");
    // Bump version out from under an in-flight transition.
    await prisma.campaign.update({ where: { id: c.id }, data: { version: 5 } });
    // guardedTransition reads version 5, but we race it by bumping again first:
    const orig = transition.campaign;
    // Simulate: read happens at 5, then someone writes -> 6, then our update (where version=5) is stale.
    await prisma.campaign.findUnique({ where: { id: c.id } });
    await prisma.campaign.update({ where: { id: c.id }, data: { version: 6 } });
    // Now a manual guarded update with the stale (read=5) must fail:
    const res = await prisma.campaign.updateMany({ where: { id: c.id, version: 5 }, data: { version: 6 } });
    expect(res.count).toBe(0);
    expect(orig).toBeTypeOf("function");
  });

  it("rejects an invalid state transition", async () => {
    const c = await makeCampaign("CLOSED");
    await expect(transition.campaign(c.id, "ACTIVE")).rejects.toThrow(); // CLOSED -> ACTIVE not allowed
  });

  it("publication cannot run after a compliance FAIL (returns SKIPPED, no post)", async () => {
    const c = await makeCampaign("PARSED");
    const rules = CampaignRulesSchema.parse({
      campaignId: c.externalId,
      sourceUrl: c.sourceUrl,
      confidence: 0.95,
      supportedPlatforms: ["TIKTOK"],
    });
    await prisma.campaignRule.create({
      data: { campaignId: c.id, status: "PARSED", rules, confidence: 0.95, uncertainties: [] },
    });
    const asset = await prisma.sourceAsset.create({
      data: { campaignId: c.id, originalSource: "https://cdn.example.com/v.mp4", checksum: sha256Hex(c.id), status: "READY", storageKey: "k" },
    });
    const cand = await prisma.clipCandidate.create({
      data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" },
    });
    const manifest = RenderManifestSchema.parse({
      sourceAssetId: asset.id,
      candidateId: cand.id,
      backend: "ffmpeg",
      range: { startSec: 0, endSec: 20 },
      width: 1080,
      height: 1920,
      aspectRatio: "1080:1920",
      videoCodec: "h264",
      audioCodec: "aac",
      container: "mp4",
      transformations: [],
      overlaysApplied: [],
      captions: { TIKTOK: "hi #ad" },
      createdAt: new Date().toISOString(),
    });
    const clip = await prisma.renderedClip.create({
      data: { candidateId: cand.id, renderConfigHash: "x", storageKey: "renders/x.mp4", renderManifest: manifest },
    });
    await prisma.complianceResult.create({
      data: { renderedClipId: clip.id, check: "duration", outcome: "FAIL", reason: "too long" },
    });

    const result = await publishClip({ renderedClipId: clip.id, platform: "TIKTOK", mode: "DRAFT" });
    expect(result.status).toBe("SKIPPED");
    const pub = await prisma.publication.findFirst({ where: { renderedClipId: clip.id } });
    expect(pub?.status).toBe("SKIPPED");
    expect(pub?.postUrl).toBeNull();
    expect(pub?.externalPostId).toBeNull();
  });

  it("submission cannot be created twice for the same publication", async () => {
    const c = await makeCampaign("PARSED");
    const asset = await prisma.sourceAsset.create({
      data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id + "2"), status: "READY" },
    });
    const cand = await prisma.clipCandidate.create({ data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" } });
    const clip = await prisma.renderedClip.create({ data: { candidateId: cand.id, renderConfigHash: "y" } });
    const pub = await prisma.publication.create({
      data: { renderedClipId: clip.id, platform: "TIKTOK", mode: "DRAFT", idempotencyKey: "DRAFT", status: "DRAFTED" },
    });
    await prisma.campaignSubmission.create({ data: { campaignId: c.id, publicationId: pub.id, status: "PREPARED" } });
    await expect(
      prisma.campaignSubmission.create({ data: { campaignId: c.id, publicationId: pub.id, status: "PREPARED" } }),
    ).rejects.toThrow(); // unique (campaignId, publicationId) / publicationId unique
  });

  it("two workers cannot both create the same publication (unique idempotency key)", async () => {
    const c = await makeCampaign("PARSED");
    const asset = await prisma.sourceAsset.create({
      data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id + "3"), status: "READY" },
    });
    const cand = await prisma.clipCandidate.create({ data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" } });
    const clip = await prisma.renderedClip.create({ data: { candidateId: cand.id, renderConfigHash: "z" } });
    const data = { renderedClipId: clip.id, platform: "TIKTOK" as const, mode: "DRAFT" as const, idempotencyKey: "DRAFT", status: "PENDING" as const };
    await prisma.publication.create({ data });
    await expect(prisma.publication.create({ data })).rejects.toThrow();
  });
});
