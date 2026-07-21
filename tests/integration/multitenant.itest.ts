import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import {
  assertCampaignAccess,
  assertClipAccess,
  assertAssetAccess,
  campaignVisibilityWhere,
  WorkspaceForbiddenError,
  type Actor,
} from "@/lib/db/workspaceScope";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const cleanupCampaigns: string[] = [];
const cleanupWorkspaces: string[] = [];

async function workspace(name: string) {
  const w = await prisma.workspace.create({ data: { name } });
  cleanupWorkspaces.push(w.id);
  return w;
}
async function campaignIn(workspaceId: string | null) {
  const c = await prisma.campaign.create({
    data: { source: "MANUAL", externalId: `mt-${Math.random().toString(36).slice(2)}`, sourceUrl: "https://example.com/discover/mt", status: "PARSED", workspaceId },
  });
  cleanupCampaigns.push(c.id);
  const asset = await prisma.sourceAsset.create({ data: { campaignId: c.id, originalSource: "s", checksum: sha256Hex(c.id), status: "READY" } });
  const cand = await prisma.clipCandidate.create({ data: { sourceAssetId: asset.id, startSec: 0, endSec: 20, status: "RENDERED" } });
  const clip = await prisma.renderedClip.create({ data: { candidateId: cand.id, renderConfigHash: "h" } });
  return { campaign: c, asset, clip };
}

afterAll(async () => {
  if (!hasDb) return;
  await prisma.campaign.deleteMany({ where: { id: { in: cleanupCampaigns } } });
  await prisma.workspace.deleteMany({ where: { id: { in: cleanupWorkspaces } } });
  await prisma.$disconnect();
});

d("multi-tenant isolation (integration)", () => {
  it("a user cannot read another workspace's campaign / asset / clip", async () => {
    const a = await workspace("A");
    const b = await workspace("B");
    const owned = await campaignIn(a.id);
    const actorB: Actor = { userId: "ub", workspaceId: b.id, role: "OPERATOR" };

    await expect(assertCampaignAccess(owned.campaign.id, actorB)).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    await expect(assertAssetAccess(owned.asset.id, actorB)).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    await expect(assertClipAccess(owned.clip.id, actorB)).rejects.toBeInstanceOf(WorkspaceForbiddenError);
  });

  it("the owning workspace can access its own resources", async () => {
    const a = await workspace("A2");
    const owned = await campaignIn(a.id);
    const actorA: Actor = { userId: "ua", workspaceId: a.id, role: "OPERATOR" };
    await expect(assertCampaignAccess(owned.campaign.id, actorA)).resolves.toBeUndefined();
    await expect(assertClipAccess(owned.clip.id, actorA)).resolves.toBeUndefined();
  });

  it("the shared discovery pool (null workspace) is visible to everyone", async () => {
    const shared = await campaignIn(null);
    const actorAny: Actor = { userId: "u", workspaceId: "someone", role: "VIEWER" };
    await expect(assertCampaignAccess(shared.campaign.id, actorAny)).resolves.toBeUndefined();
  });

  it("visibility filter excludes other workspaces but includes own + shared", async () => {
    const a = await workspace("A3");
    const b = await workspace("B3");
    const own = await campaignIn(a.id);
    const other = await campaignIn(b.id);
    const shared = await campaignIn(null);
    const actorA: Actor = { userId: "ua", workspaceId: a.id, role: "OPERATOR" };

    const visible = await prisma.campaign.findMany({
      where: { AND: [campaignVisibilityWhere(actorA), { id: { in: [own.campaign.id, other.campaign.id, shared.campaign.id] } }] },
      select: { id: true },
    });
    const ids = visible.map((v) => v.id);
    expect(ids).toContain(own.campaign.id);
    expect(ids).toContain(shared.campaign.id);
    expect(ids).not.toContain(other.campaign.id);
  });
});
