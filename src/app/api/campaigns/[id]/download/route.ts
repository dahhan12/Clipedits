import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { enqueueIngest } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/** Enqueue resource downloading for a campaign. Requires OPERATOR/ADMIN. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "resource.download")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({ where: { id } }).catch(() => null);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  try {
    await prisma.jobRun.deleteMany({ where: { queue: "ingest", jobKey: `ingest:${id}` } }).catch(() => undefined);
    await enqueueIngest(id);
    await audit({ action: "campaign.download.enqueued", entityType: "Campaign", entityId: id, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to enqueue download");
    return NextResponse.json({ error: "Could not enqueue download (is Redis reachable?)" }, { status: 502 });
  }
}
