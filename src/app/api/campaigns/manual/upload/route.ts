import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { can, currentRole } from "@/lib/security/rbac";
import { actorFromHeaders } from "@/lib/db/workspaceScope";
import { createFromDocument } from "@/services/discovery/manualEntryService";
import { logger } from "@/lib/logging/logger";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown"];

/**
 * Manually add a campaign by uploading a screenshot, PDF, or text document.
 * Text is extracted (Claude vision/document for images & PDFs) and parsed.
 * Requires OPERATOR/ADMIN.
 */
export async function POST(req: Request) {
  const role = currentRole(await headers());
  if (!can(role, "campaign.create")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const mediaType = file.type || "application/octet-stream";
  if (!ALLOWED.includes(mediaType)) {
    return NextResponse.json({ error: `Unsupported type: ${mediaType}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const title = (form?.get("title") as string | null) ?? undefined;
    const result = await createFromDocument({ bytes, mediaType, filename: file.name, title, workspaceId: actorFromHeaders(await headers()).workspaceId });
    return NextResponse.json({ ok: true, campaignId: result.campaignId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process upload";
    logger.error({ err }, "Manual campaign upload failed");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
