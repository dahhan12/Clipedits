import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { can, currentRole } from "@/lib/security/rbac";
import { rateLimitOr429, clientIp } from "@/lib/security/rateLimit";
import { confirmSubmission } from "@/services/submission/submissionService";
import { logger } from "@/lib/logging/logger";

/**
 * Confirm and execute a campaign submission that is awaiting sign-off. This is
 * the human confirmation gate required before the final MVP submit. Requires
 * `submission.submit` (ADMIN).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "submission.submit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const __rl = await rateLimitOr429("submit", clientIp(await headers()));
  if (__rl) return __rl;
  const { id } = await params;

  const submission = await prisma.campaignSubmission.findUnique({ where: { id } }).catch(() => null);
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  try {
    const result = await confirmSubmission(id);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    logger.error({ err, id }, "Failed to confirm submission");
    return NextResponse.json({ error: "Submission failed" }, { status: 502 });
  }
}
