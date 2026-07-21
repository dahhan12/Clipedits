import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { discoveryQueue } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/** Enqueue a discovery run. Requires OPERATOR/ADMIN. */
export async function POST() {
  const role = currentRole(await headers());
  if (!can(role, "campaign.reparse")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await discoveryQueue.add("run", {}, { jobId: `discovery__${Date.now()}` });
    await audit({ action: "discovery.enqueued", entityType: "Queue", role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue discovery");
    return NextResponse.json(
      { error: "Could not enqueue discovery (is Redis reachable?)" },
      { status: 502 },
    );
  }
}
