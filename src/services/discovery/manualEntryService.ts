import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";
import { assertSafeUrl } from "@/lib/security/url";
import { sha256Hex } from "@/lib/security/crypto";
import { enqueueParse } from "@/lib/queue/queues";

/**
 * Manual campaign entry. The user can paste a campaign URL or paste raw campaign
 * text; either creates a `MANUAL`-source Campaign and enqueues parsing. Pasted
 * text is stored as the revision snapshot so the parser uses it directly
 * instead of fetching a page.
 */

function externalIdFromUrl(url: string): string {
  const m = url.match(/\/discover\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? `url-${sha256Hex(url).slice(0, 16)}`;
}

/** Create a manual campaign from a pasted campaign URL and enqueue parsing. */
export async function createFromUrl(rawUrl: string, workspaceId?: string | null): Promise<{ campaignId: string }> {
  const url = await assertSafeUrl(rawUrl);
  const externalId = externalIdFromUrl(url.toString());
  const pageHash = sha256Hex(`manual-url:${url.toString()}`);

  const campaign = await prisma.campaign.upsert({
    where: { source_externalId: { source: "MANUAL", externalId } },
    create: { source: "MANUAL", externalId, sourceUrl: url.toString(), lastPageHash: pageHash, status: "DISCOVERED", workspaceId: workspaceId ?? null },
    update: { sourceUrl: url.toString() },
  });

  await prisma.campaignRevision.upsert({
    where: { campaignId_pageHash: { campaignId: campaign.id, pageHash } },
    create: { campaignId: campaign.id, pageHash },
    update: {},
  });

  await audit({ action: "campaign.manual.url", entityType: "Campaign", entityId: campaign.id, metadata: { url: url.toString() } });
  await enqueueParse(campaign.id);
  logger.info({ campaignId: campaign.id }, "Manual campaign created from URL");
  return { campaignId: campaign.id };
}

/**
 * Create a manual campaign from an uploaded screenshot/PDF/text document by
 * extracting its text (Claude vision/document for images & PDFs) and then
 * parsing that text. Throws if no text could be extracted (e.g. sandbox mode).
 */
export async function createFromDocument(input: {
  bytes: Buffer;
  mediaType: string;
  filename?: string;
  title?: string;
  workspaceId?: string | null;
}): Promise<{ campaignId: string }> {
  let text: string;
  if (input.mediaType.startsWith("text/")) {
    text = input.bytes.toString("utf8");
  } else if (input.mediaType.startsWith("image/") || input.mediaType === "application/pdf") {
    const { extractTextFromMedia } = await import("@/lib/ai/anthropic");
    text = await extractTextFromMedia({ base64: input.bytes.toString("base64"), mediaType: input.mediaType });
  } else {
    throw new Error(`Unsupported upload type: ${input.mediaType}`);
  }

  if (!text || text.trim().length < 20) {
    throw new Error("Could not extract enough campaign text from the upload (a live model is required for images/PDFs)");
  }
  return createFromText({ text, title: input.title ?? input.filename, workspaceId: input.workspaceId });
}

/**
 * Create a manual campaign from pasted campaign text (and optional title/URL).
 * The text is stored as the revision snapshot and parsed directly.
 */
export async function createFromText(input: {
  text: string;
  title?: string;
  sourceUrl?: string;
  workspaceId?: string | null;
}): Promise<{ campaignId: string }> {
  const text = input.text.trim();
  if (text.length < 20) throw new Error("Campaign text is too short to parse");

  const externalId = `text-${sha256Hex(text).slice(0, 16)}`;
  const pageHash = sha256Hex(`manual-text:${externalId}`);
  const sourceUrl = input.sourceUrl && input.sourceUrl.length > 0 ? input.sourceUrl : `manual://${externalId}`;

  const campaign = await prisma.campaign.upsert({
    where: { source_externalId: { source: "MANUAL", externalId } },
    create: { source: "MANUAL", externalId, title: input.title, sourceUrl, lastPageHash: pageHash, status: "DISCOVERED", workspaceId: input.workspaceId ?? null },
    update: { title: input.title, sourceUrl },
  });

  // Store the pasted text as the snapshot the parser will consume.
  await prisma.campaignRevision.upsert({
    where: { campaignId_pageHash: { campaignId: campaign.id, pageHash } },
    create: { campaignId: campaign.id, pageHash, rawSnapshot: text.slice(0, 30_000) },
    update: { rawSnapshot: text.slice(0, 30_000) },
  });

  await audit({ action: "campaign.manual.text", entityType: "Campaign", entityId: campaign.id, metadata: { chars: text.length } });
  await enqueueParse(campaign.id);
  logger.info({ campaignId: campaign.id }, "Manual campaign created from text");
  return { campaignId: campaign.id };
}
