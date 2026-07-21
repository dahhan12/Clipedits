import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db/prisma";
import { objectStore } from "@/adapters/storage/objectStore";
import { logger } from "@/lib/logging/logger";

/** Stream a rendered clip's thumbnail JPEG for the dashboard preview poster. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await prisma.renderedClip.findUnique({ where: { id } }).catch(() => null);
  if (!clip?.thumbnailKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const node = await objectStore().getStream(clip.thumbnailKey);
    const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
    return new NextResponse(web, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    logger.error({ err, id }, "Failed to stream thumbnail");
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
