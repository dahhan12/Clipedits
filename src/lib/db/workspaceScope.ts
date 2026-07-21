import { prisma } from "@/lib/db/prisma";
import { sessionFromCookieHeader } from "@/lib/security/session";

/**
 * Centralised multi-tenant scoping. Isolation is enforced HERE, not in the UI.
 *
 * Visibility model: a workspace's users see campaigns whose `workspaceId` equals
 * their workspace, plus the shared discovery pool (`workspaceId = null`, i.e.
 * auto-discovered but not yet claimed). Campaigns owned by a *different*
 * workspace are never visible. All child entities (assets, clips, publications,
 * submissions) are reachable only via a campaign the caller can access.
 */

export class WorkspaceForbiddenError extends Error {
  constructor(msg = "Not permitted for this workspace") {
    super(msg);
    this.name = "WorkspaceForbiddenError";
  }
}

export interface Actor {
  userId: string | null;
  workspaceId: string | null;
  role: string;
}

/** Resolve the caller's actor from the request cookies. */
export function actorFromHeaders(headers: Headers): Actor {
  const s = sessionFromCookieHeader(headers.get("cookie"));
  return { userId: s?.userId ?? null, workspaceId: s?.workspaceId ?? null, role: s?.role ?? "VIEWER" };
}

/** Prisma `where` fragment limiting Campaign rows to those the actor may see. */
export function campaignVisibilityWhere(actor: Actor): { OR: Array<{ workspaceId: string | null }> } {
  const or: Array<{ workspaceId: string | null }> = [{ workspaceId: null }];
  if (actor.workspaceId) or.push({ workspaceId: actor.workspaceId });
  return { OR: or };
}

/**
 * Assert the actor may access (read/act on) a campaign. Returns the campaign's
 * workspaceId. Throws WorkspaceForbiddenError when the campaign belongs to a
 * different workspace or does not exist.
 */
export async function assertCampaignAccess(campaignId: string, actor: Actor): Promise<void> {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { workspaceId: true } });
  if (!c) throw new WorkspaceForbiddenError("Campaign not found");
  if (c.workspaceId !== null && c.workspaceId !== actor.workspaceId) {
    throw new WorkspaceForbiddenError();
  }
}

/** Assert access to a rendered clip via its campaign (used by signed URLs). */
export async function assertClipAccess(renderedClipId: string, actor: Actor): Promise<void> {
  const clip = await prisma.renderedClip.findUnique({
    where: { id: renderedClipId },
    select: { candidate: { select: { sourceAsset: { select: { campaign: { select: { workspaceId: true } } } } } } },
  });
  const wsId = clip?.candidate.sourceAsset.campaign.workspaceId;
  if (wsId === undefined) throw new WorkspaceForbiddenError("Clip not found");
  if (wsId !== null && wsId !== actor.workspaceId) throw new WorkspaceForbiddenError();
}

/** Assert access to a source asset via its campaign. */
export async function assertAssetAccess(assetId: string, actor: Actor): Promise<void> {
  const asset = await prisma.sourceAsset.findUnique({ where: { id: assetId }, select: { campaign: { select: { workspaceId: true } } } });
  const wsId = asset?.campaign.workspaceId;
  if (wsId === undefined) throw new WorkspaceForbiddenError("Asset not found");
  if (wsId !== null && wsId !== actor.workspaceId) throw new WorkspaceForbiddenError();
}

/** Assert access to a clip candidate via its campaign. */
export async function assertCandidateAccess(candidateId: string, actor: Actor): Promise<void> {
  const cand = await prisma.clipCandidate.findUnique({
    where: { id: candidateId },
    select: { sourceAsset: { select: { campaign: { select: { workspaceId: true } } } } },
  });
  const wsId = cand?.sourceAsset.campaign.workspaceId;
  if (wsId === undefined) throw new WorkspaceForbiddenError("Candidate not found");
  if (wsId !== null && wsId !== actor.workspaceId) throw new WorkspaceForbiddenError();
}
