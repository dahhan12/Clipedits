import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { enqueuePublish } from "@/lib/queue/queues";
import { can, currentRole } from "@/lib/security/rbac";
import { rateLimitOr429, clientIp } from "@/lib/security/rateLimit";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

const BodySchema = z.object({
  platform: z.enum(["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"]),
  mode: z.enum(["AUTO", "DRAFT", "MANUAL"]).default("DRAFT"),
});

/**
 * Enqueue publishing for a rendered clip. `mode: DRAFT|MANUAL` needs
 * `publish.draft`; `mode: AUTO` ("publish now") needs `publish.now`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = currentRole(await headers());
  const { id } = await params;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { platform, mode } = parsed.data;

  const action = mode === "AUTO" ? "publish.now" : "publish.draft";
  if (!can(role, action)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rl = await rateLimitOr429("publish", clientIp(await headers()));
  if (rl) return rl;

  const clip = await prisma.renderedClip.findUnique({ where: { id } }).catch(() => null);
  if (!clip) return NextResponse.json({ error: "Rendered clip not found" }, { status: 404 });

  try {
    await prisma.jobRun
      .deleteMany({ where: { queue: "publish", jobKey: `publish:${id}:${platform}:${mode}` } })
      .catch(() => undefined);
    await enqueuePublish({ renderedClipId: id, platform, mode });
    await audit({ action: "clip.publish.enqueued", entityType: "RenderedClip", entityId: id, role, metadata: { platform, mode } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to enqueue publish");
    return NextResponse.json({ error: "Could not enqueue publish (is Redis reachable?)" }, { status: 502 });
  }
}
