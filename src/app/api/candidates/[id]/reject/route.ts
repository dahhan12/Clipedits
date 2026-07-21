import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";

/** Reject a clip candidate. Requires OPERATOR/ADMIN. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "clip.reject")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const candidate = await prisma.clipCandidate.findUnique({ where: { id } }).catch(() => null);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  await prisma.clipCandidate.update({
    where: { id },
    data: { status: "REJECTED", rejectionReason: "Rejected by operator" },
  });
  await audit({ action: "clip.rejected", entityType: "ClipCandidate", entityId: id, role });
  return NextResponse.json({ ok: true });
}
