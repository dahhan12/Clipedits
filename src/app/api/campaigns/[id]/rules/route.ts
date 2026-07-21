import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { can, currentRole } from "@/lib/security/rbac";
import { saveReviewedRules } from "@/services/parsing/ruleReviewService";
import { logger } from "@/lib/logging/logger";

/**
 * Save operator-corrected campaign rules as a new reviewed revision. Requires
 * `rule.review` (OPERATOR/ADMIN). The body is the full CampaignRules object and
 * is re-validated with Zod server-side.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  if (!can(role, "rule.review")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await saveReviewedRules(id, body);
    return NextResponse.json({ ok: true, ruleId: result.ruleId });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Rules failed validation", issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Failed to save rules";
    logger.error({ err, id }, "Failed to save reviewed rules");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
