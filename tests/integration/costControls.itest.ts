import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import { publishClip } from "@/services/publishing/publishService";
import {
  setHalted,
  setGlobalDailyCapUsd,
  isHalted,
  getGlobalDailyCapUsd,
  _clearSettingCache,
} from "@/services/ops/killSwitch";
import { recordUsage, getBudgetStatus, SHARED_WORKSPACE } from "@/services/ops/costService";
import { applyCampaignStopConditions } from "@/services/ops/campaignStopConditions";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { RenderManifestSchema } from "@/lib/schemas/render";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const campaignIds: string[] = [];

async function makeRenderedClip(opts: { rules?: object; compliancePass?: boolean } = {}): Promise<{ clipId: string; campaignId: string }> {
  const c = await prisma.campaign.create({
    data: {
      source: "MANUAL",
      externalId: `cost-itest-${Math.random().toString(36).slice(2)}`,
      sourceUrl: "https://example.com/discover/cost",
      status: "PARSED",
    },
  });
  campaignIds.push(c.id);
  const rules = CampaignRulesSchema.parse({
    campaignId: c.externalId,
    sourceUrl: c.sourceUrl,
    confidence: 0.95,
    supportedPlatforms: ["TIKTOK"],
    ...(opts.rules ?? {}),
  });
  await prisma.campaignRule.create({ data: { campaignId: c.id, status: "PARSED", rules, confidence: 0.95, uncertainties: [] } });
  const asset = await prisma.sourceAsset.create({
    data: { campaignId: c.id, originalSource: "https://cdn.example.com/v.mp4", checksum: sha256Hex(c.id), status: "READY", storageKey: "k" },
  });
  const cand = await prisma.clipCandidate.create({ data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" } });
  const manifest = RenderManifestSchema.parse({
    sourceAssetId: asset.id, candidateId: cand.id, backend: "ffmpeg",
    range: { startSec: 0, endSec: 20 }, width: 1080, height: 1920, aspectRatio: "1080:1920",
    videoCodec: "h264", audioCodec: "aac", container: "mp4", transformations: [], overlaysApplied: [],
    captions: { TIKTOK: "hi #ad" }, createdAt: new Date().toISOString(),
  });
  const clip = await prisma.renderedClip.create({
    data: { candidateId: cand.id, renderConfigHash: `x-${Math.random()}`, storageKey: "renders/x.mp4", renderManifest: manifest },
  });
  if (opts.compliancePass !== false) {
    await prisma.complianceResult.create({ data: { renderedClipId: clip.id, check: "duration", outcome: "PASS", reason: "ok" } });
  }
  return { clipId: clip.id, campaignId: c.id };
}

afterAll(async () => {
  if (!hasDb) return;
  await setHalted("publishing", false);
  await setGlobalDailyCapUsd(null);
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.$disconnect();
});

beforeEach(() => _clearSettingCache());

d("cost controls & kill switches (integration)", () => {
  it("toggles a kill switch through the settings store", async () => {
    await setHalted("rendering", true, "tester");
    _clearSettingCache();
    expect(await isHalted("rendering")).toBe(true);
    await setHalted("rendering", false, "tester");
    _clearSettingCache();
    expect(await isHalted("rendering")).toBe(false);
  });

  it("publishing kill switch makes publishClip SKIP without posting", async () => {
    const { clipId } = await makeRenderedClip();
    await setHalted("publishing", true, "tester");
    _clearSettingCache();
    const res = await publishClip({ renderedClipId: clipId, platform: "TIKTOK", mode: "DRAFT" });
    expect(res.status).toBe("SKIPPED");
    const pub = await prisma.publication.findFirst({ where: { renderedClipId: clipId } });
    expect(pub?.failureReason).toMatch(/kill switch/i);
    await setHalted("publishing", false, "tester");
  });

  it("records usage and enforces the global daily cap", async () => {
    await setGlobalDailyCapUsd(0.05, "tester");
    _clearSettingCache();
    expect(await getGlobalDailyCapUsd()).toBe(0.05);
    // Spend over the cap on the shared pool, then a fresh check must block.
    for (let i = 0; i < 3; i++) await recordUsage({ kind: "ai" }); // 3 * 0.03 = 0.09 > 0.05
    const status = await getBudgetStatus(SHARED_WORKSPACE);
    expect(status.allowed).toBe(false);
    expect(status.spentUsd).toBeGreaterThanOrEqual(0.05);
    await setGlobalDailyCapUsd(null, "tester");
  });

  it("auto-pauses a campaign when the post cap is reached", async () => {
    const { clipId, campaignId } = await makeRenderedClip({ rules: { maxPosts: 1 } });
    // Simulate a published post so publicationCount >= maxPosts.
    await prisma.publication.create({
      data: { renderedClipId: clipId, platform: "TIKTOK", mode: "DRAFT", idempotencyKey: "seed", status: "PUBLISHED" },
    });
    const evalResult = await applyCampaignStopConditions(campaignId);
    expect(evalResult.shouldPause).toBe(true);
    const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(c?.status).toBe("PAUSED");
  });
});
