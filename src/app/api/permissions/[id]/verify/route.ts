import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { can, currentRole } from "@/lib/security/rbac";
import { sessionFromCookieHeader } from "@/lib/security/session";
import { verifyPermission } from "@/services/rights/permissionService";
import { logger } from "@/lib/logging/logger";

/** Operator verification of an asset's rights permission. Requires rights.verify. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const hdrs = await headers();
  const role = currentRole(hdrs);
  if (!can(role, "rights.verify")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const permission = await prisma.assetPermission.findUnique({ where: { id } }).catch(() => null);
  if (!permission) return NextResponse.json({ error: "Permission not found" }, { status: 404 });

  try {
    const userId = sessionFromCookieHeader(hdrs.get("cookie"))?.userId ?? "operator";
    await verifyPermission(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to verify permission");
    return NextResponse.json({ error: "Verify failed" }, { status: 500 });
  }
}
