import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { can, currentRole } from "@/lib/security/rbac";
import { rateLimitOr429, clientIp } from "@/lib/security/rateLimit";
import { createFromUrl, createFromText } from "@/services/discovery/manualEntryService";
import { logger } from "@/lib/logging/logger";

const BodySchema = z.union([
  z.object({ mode: z.literal("url"), url: z.string().url() }),
  z.object({
    mode: z.literal("text"),
    text: z.string().min(20),
    title: z.string().optional(),
    sourceUrl: z.string().url().optional(),
  }),
]);

/** Manually add a campaign by URL or pasted text. Requires OPERATOR/ADMIN. */
export async function POST(req: Request) {
  const hdrs = await headers();
  const role = currentRole(hdrs);
  if (!can(role, "campaign.create")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rl = await rateLimitOr429("campaignCreate", clientIp(hdrs));
  if (rl) return rl;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  try {
    const result =
      parsed.data.mode === "url"
        ? await createFromUrl(parsed.data.url)
        : await createFromText({ text: parsed.data.text, title: parsed.data.title, sourceUrl: parsed.data.sourceUrl });
    return NextResponse.json({ ok: true, campaignId: result.campaignId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create campaign";
    logger.error({ err }, "Manual campaign creation failed");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
