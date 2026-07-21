import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { enqueueClip } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { rateLimitOr429, clientIp } from "@/lib/security/rateLimit";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/** (Re)generate clip candidates for a source asset. Requires OPERATOR/ADMIN. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "clip.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const __rl = await rateLimitOr429("clipGen", clientIp(await headers()));
  if (__rl) return __rl;
  const { id } = await params;

  const asset = await prisma.sourceAsset.findUnique({ where: { id } }).catch(() => null);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await prisma.jobRun.deleteMany({ where: { queue: "clip", jobKey: `clip:${id}` } }).catch(() => undefined);
    await enqueueClip(id);
    await audit({ action: "asset.generateClips.enqueued", entityType: "SourceAsset", entityId: id, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to enqueue clip generation");
    return NextResponse.json({ error: "Could not enqueue (is Redis reachable?)" }, { status: 502 });
  }
}
