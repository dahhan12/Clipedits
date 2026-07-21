import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { enqueueClip } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/**
 * Regenerate clip candidates for the asset behind this candidate. Requires
 * OPERATOR/ADMIN. Re-running generation drops non-rendered candidates and
 * rebuilds them from the (possibly updated) rules.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "clip.generate")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const candidate = await prisma.clipCandidate.findUnique({ where: { id } }).catch(() => null);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  try {
    await prisma.jobRun
      .deleteMany({ where: { queue: "clip", jobKey: `clip:${candidate.sourceAssetId}` } })
      .catch(() => undefined);
    await enqueueClip(candidate.sourceAssetId);
    await audit({ action: "clip.regenerate.enqueued", entityType: "SourceAsset", entityId: candidate.sourceAssetId, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to enqueue regenerate");
    return NextResponse.json({ error: "Could not enqueue (is Redis reachable?)" }, { status: 502 });
  }
}
