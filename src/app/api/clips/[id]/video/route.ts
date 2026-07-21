import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db/prisma";
import { objectStore } from "@/adapters/storage/objectStore";
import { logger } from "@/lib/logging/logger";

/**
 * Stream a rendered clip's MP4 for in-dashboard preview. Reads from the object
 * store (R2 or local sandbox). Not a public share link — served to authenticated
 * dashboard users only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await prisma.renderedClip.findUnique({ where: { id } }).catch(() => null);
  if (!clip?.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const store = objectStore();
    // Prefer a short-lived signed URL when the backend supports it (R2).
    const signed = await store.signedDownloadUrl(clip.storageKey).catch(() => null);
    if (signed) return NextResponse.redirect(signed, 302);

    const node = await store.getStream(clip.storageKey);
    const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
    return new NextResponse(web, {
      headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    logger.error({ err, id }, "Failed to stream clip");
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
