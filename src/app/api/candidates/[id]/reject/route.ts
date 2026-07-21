import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { can, currentRole } from "@/lib/security/rbac";
import { actorFromHeaders, assertCandidateAccess } from "@/lib/db/workspaceScope";
import { audit } from "@/lib/db/audit";
import { transition } from "@/lib/db/guardedTransition";

/** Reject a clip candidate. Requires OPERATOR/ADMIN. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "clip.reject")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    await assertCandidateAccess(id, actorFromHeaders(await headers()));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const candidate = await prisma.clipCandidate.findUnique({ where: { id } }).catch(() => null);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  await transition.clipCandidate(id, "REJECTED", { rejectionReason: "Rejected by operator" });
  await audit({ action: "clip.rejected", entityType: "ClipCandidate", entityId: id, role });
  return NextResponse.json({ ok: true });
}
