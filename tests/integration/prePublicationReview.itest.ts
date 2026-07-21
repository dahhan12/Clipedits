import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import {
  submitPrePublicationReview,
  latestApprovedReview,
} from "@/services/publishing/prePublicationService";

/**
 * Operator pre-publication review + override, against a real DB. Verifies the
 * audit-trail record, the hard gates (FAIL / safety-critical REVIEW / incomplete
 * acknowledgement are non-approvable), and that a REJECTED decision is always
 * recordable. Self-skips without DATABASE_URL. The APPROVED happy path also
 * enqueues a publish, so it depends on Redis (present in CI).
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const campaignIds: string[] = [];

async function makeClip(compliance: Array<{ check: string; outcome: string }>): Promise<string> {
  const c = await prisma.campaign.create({
    data: {
      source: "MANUAL",
      externalId: `rev-itest-${Math.random().toString(36).slice(2)}`,
      sourceUrl: "https://example.com/discover/rev",
      status: "PARSED",
    },
  });
  campaignIds.push(c.id);
  const asset = await prisma.sourceAsset.create({
    data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id), status: "READY", storageKey: "k" },
  });
  const cand = await prisma.clipCandidate.create({
    data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" },
  });
  const clip = await prisma.renderedClip.create({
    data: { candidateId: cand.id, renderConfigHash: `rc-${Math.random()}` },
  });
  await prisma.complianceResult.createMany({
    data: compliance.map((f) => ({ renderedClipId: clip.id, check: f.check, outcome: f.outcome as never, reason: f.check })),
  });
  return clip.id;
}

afterAll(async () => {
  if (!hasDb) return;
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.$disconnect();
});

d("pre-publication review (integration)", () => {
  it("records a REJECTED decision without publishing", async () => {
    const clipId = await makeClip([{ check: "duration", outcome: "REVIEW" }]);
    const res = await submitPrePublicationReview({
      renderedClipId: clipId,
      platform: "TIKTOK",
      mode: "AUTO",
      decision: "REJECTED",
      justification: "content not suitable",
      acknowledgedChecks: [],
      reviewerId: "op-1",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.prePublicationReview.findFirst({ where: { renderedClipId: clipId } });
    expect(row?.decision).toBe("REJECTED");
    const evt = await prisma.auditEvent.findFirst({ where: { entityId: clipId, action: "clip.review.rejected" } });
    expect(evt).toBeTruthy();
  });

  it("refuses approval when a FAIL is present", async () => {
    const clipId = await makeClip([{ check: "fileFormat", outcome: "FAIL" }, { check: "duration", outcome: "REVIEW" }]);
    const res = await submitPrePublicationReview({
      renderedClipId: clipId,
      platform: "TIKTOK",
      mode: "AUTO",
      decision: "APPROVED",
      justification: "looks fine to me",
      acknowledgedChecks: ["duration"],
      reviewerId: "op-1",
    });
    expect(res).toEqual({ ok: false, reason: "has_fail" });
    expect(await prisma.prePublicationReview.count({ where: { renderedClipId: clipId } })).toBe(0);
  });

  it("refuses approval when a safety-critical check needs REVIEW", async () => {
    const clipId = await makeClip([{ check: "sourcePermission", outcome: "REVIEW" }]);
    const res = await submitPrePublicationReview({
      renderedClipId: clipId,
      platform: "TIKTOK",
      mode: "AUTO",
      decision: "APPROVED",
      justification: "rights look ok",
      acknowledgedChecks: ["sourcePermission"],
      reviewerId: "op-1",
    });
    expect(res).toEqual({ ok: false, reason: "blocking_review" });
  });

  it("refuses approval when a waivable REVIEW is not acknowledged", async () => {
    const clipId = await makeClip([
      { check: "duration", outcome: "REVIEW" },
      { check: "publicPostRequirement", outcome: "REVIEW" },
    ]);
    const res = await submitPrePublicationReview({
      renderedClipId: clipId,
      platform: "TIKTOK",
      mode: "AUTO",
      decision: "APPROVED",
      justification: "verified duration only",
      acknowledgedChecks: ["duration"], // missing publicPostRequirement
      reviewerId: "op-1",
    });
    expect(res).toEqual({ ok: false, reason: "incomplete_ack" });
  });

  it("approves and records an override; latestApprovedReview returns it (needs Redis for enqueue)", async () => {
    const clipId = await makeClip([{ check: "duration", outcome: "REVIEW" }, { check: "aspectRatio", outcome: "PASS" }]);
    const res = await submitPrePublicationReview({
      renderedClipId: clipId,
      platform: "TIKTOK",
      mode: "AUTO",
      decision: "APPROVED",
      justification: "manually verified the duration is acceptable",
      acknowledgedChecks: ["duration"],
      reviewerId: "op-1",
    });
    expect(res.ok).toBe(true);
    const latest = await latestApprovedReview(clipId, "TIKTOK");
    expect(latest?.decision).toBe("APPROVED");
    expect(latest?.acknowledgedChecks).toEqual(["duration"]);
  });
});
