import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { enqueueRender } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { actorFromHeaders, assertCandidateAccess } from "@/lib/db/workspaceScope";
import { audit } from "@/lib/db/audit";
import { transition } from "@/lib/db/guardedTransition";
import { logger } from "@/lib/logging/logger";

/** Approve a clip candidate and enqueue rendering. Requires OPERATOR/ADMIN. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "clip.approve")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    await assertCandidateAccess(id, actorFromHeaders(await headers()));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const candidate = await prisma.clipCandidate.findUnique({ where: { id } }).catch(() => null);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  try {
    await transition.clipCandidate(id, "APPROVED", { rejectionReason: null });
    await prisma.jobRun.deleteMany({ where: { queue: "render", jobKey: `render:${id}` } }).catch(() => undefined);
    await enqueueRender(id);
    await audit({ action: "clip.approved", entityType: "ClipCandidate", entityId: id, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to approve candidate");
    return NextResponse.json({ error: "Could not enqueue render (is Redis reachable?)" }, { status: 502 });
  }
}
