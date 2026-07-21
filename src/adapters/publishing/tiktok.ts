import { readFile, stat } from "node:fs/promises";
import { logger } from "@/lib/logging/logger";
import { recordProviderCall } from "@/lib/observability/providerMetrics";
import type { PublishProvider, PublishInput, PublishResult, PostMetrics } from "./types";

/**
 * TikTok Content Posting API provider.
 *
 * With a valid access token: initializes a video upload (inbox/draft for
 * DRAFT/MANUAL, direct-post for AUTO), uploads the file, and returns the
 * publish id. Without a token it prepares a local DRAFT — it never uses browser
 * automation to imitate posting, and never logs the token.
 */
export class TikTokProvider implements PublishProvider {
  readonly platform = "TIKTOK" as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { status: "DRAFTED", note: "Prepared local draft (no TikTok credentials connected)." };
    }
    return recordProviderCall("tiktok", `publish:${input.mode}`, () => this.publishLive(input));
  }

  private async publishLive(input: PublishInput): Promise<PublishResult> {
    const size = (await stat(input.localPath)).size;
    const direct = input.mode === "AUTO";
    const initUrl = direct
      ? "https://open.tiktokapis.com/v2/post/publish/video/init/"
      : "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

    const initResp = await fetch(initUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        ...(direct
          ? { post_info: { title: input.caption.slice(0, 2200), privacy_level: "SELF_ONLY" } }
          : {}),
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: size,
          total_chunk_count: 1,
        },
      }),
    });
    if (!initResp.ok) throw new Error(`TikTok init failed: ${initResp.status}`);
    const init = (await initResp.json()) as {
      data?: { publish_id?: string; upload_url?: string };
    };
    const uploadUrl = init.data?.upload_url;
    const publishId = init.data?.publish_id;
    if (!uploadUrl || !publishId) throw new Error("TikTok init returned no upload url");

    const file = await readFile(input.localPath);
    const putResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${size - 1}/${size}`,
      },
      body: file,
    });
    if (!putResp.ok) throw new Error(`TikTok upload failed: ${putResp.status}`);

    logger.info({ publishId, direct }, "TikTok upload complete");
    return {
      status: direct ? "PUBLISHED" : "DRAFTED",
      externalPostId: publishId,
      note: direct ? "Direct-posted (privacy SELF_ONLY until reviewed)." : "Uploaded to TikTok inbox as draft.",
    };
  }

  // Analytics require the TikTok Display/Research API scope. Returns null until
  // that access is connected — the tracker records "unknown", never fabricated.
  async getMetrics(_externalPostId: string, _accessToken?: string): Promise<PostMetrics | null> {
    return null;
  }
  async getStatus(_externalPostId: string, _accessToken?: string): Promise<string | null> {
    return null;
  }
}
