import { readFile, stat } from "node:fs/promises";
import { logger } from "@/lib/logging/logger";
import { recordProviderCall } from "@/lib/observability/providerMetrics";
import type { PublishProvider, PublishInput, PublishResult, PostMetrics } from "./types";

/**
 * YouTube Shorts provider (YouTube Data API v3, resumable upload).
 *
 * With a token it starts a resumable upload session, PUTs the file, and creates
 * the video with privacy `private` for DRAFT/MANUAL or `public` for AUTO. The
 * `#Shorts` marker in the description is already added by the caption builder.
 * Without a token it prepares a local DRAFT.
 */
export class YouTubeShortsProvider implements PublishProvider {
  readonly platform = "YOUTUBE_SHORTS" as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { status: "DRAFTED", note: "Prepared local draft (no YouTube credentials connected)." };
    }
    return recordProviderCall("youtube", `publish:${input.mode}`, () => this.publishLive(input));
  }

  private async publishLive(input: PublishInput): Promise<PublishResult> {
    const size = (await stat(input.localPath)).size;
    const [title, ...rest] = input.caption.split("\n");
    const privacyStatus = input.mode === "AUTO" ? "public" : "private";

    const metadata = {
      snippet: { title: (title ?? "Short").slice(0, 100), description: rest.join("\n").slice(0, 5000) },
      status: { privacyStatus, selfDeclaredMadeForKids: false },
    };

    const startResp = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(size),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!startResp.ok) throw new Error(`YouTube upload init failed: ${startResp.status}`);
    const uploadUrl = startResp.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube init returned no upload location");

    const file = await readFile(input.localPath);
    const putResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: file,
    });
    if (!putResp.ok) throw new Error(`YouTube upload failed: ${putResp.status}`);
    const video = (await putResp.json()) as { id?: string };
    logger.info({ videoId: video.id, privacyStatus }, "YouTube Short uploaded");

    return {
      status: privacyStatus === "public" ? "PUBLISHED" : "DRAFTED",
      externalPostId: video.id,
      postUrl: video.id ? `https://www.youtube.com/shorts/${video.id}` : undefined,
      note: `Uploaded with privacy=${privacyStatus}.`,
    };
  }

  /** YouTube Analytics via the Data API (statistics part). Null when no token. */
  async getMetrics(externalPostId: string, accessToken?: string): Promise<PostMetrics | null> {
    if (!accessToken) return null;
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalPostId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!resp.ok) return null;
      const body = (await resp.json()) as {
        items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
      };
      const s = body.items?.[0]?.statistics;
      if (!s) return null;
      return {
        views: s.viewCount != null ? Number(s.viewCount) : null,
        likes: s.likeCount != null ? Number(s.likeCount) : null,
        comments: s.commentCount != null ? Number(s.commentCount) : null,
        shares: null,
      };
    } catch (err) {
      logger.warn({ err }, "YouTube metrics fetch failed");
      return null;
    }
  }
  async getStatus(_externalPostId: string, _accessToken?: string): Promise<string | null> {
    return null;
  }
}
