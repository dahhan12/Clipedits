import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { enqueueParse } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/** Re-enqueue parsing for a campaign. Requires OPERATOR/ADMIN. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = currentRole(await headers());
  if (!can(role, "campaign.reparse")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({ where: { id } }).catch(() => null);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  try {
    // Clear any prior SUCCEEDED job so the reparse is allowed to run again.
    await prisma.jobRun
      .deleteMany({ where: { queue: "parse", jobKey: `parse:${id}` } })
      .catch(() => undefined);
    await enqueueParse(id);
    await audit({ action: "campaign.reparse.enqueued", entityType: "Campaign", entityId: id, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to enqueue reparse");
    return NextResponse.json(
      { error: "Could not enqueue reparse (is Redis reachable?)" },
      { status: 502 },
    );
  }
}
