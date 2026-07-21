import { logger } from "@/lib/logging/logger";
import type { PublishProvider, PublishInput, PublishResult } from "./types";

/**
 * Instagram Reels provider (Facebook Graph API).
 *
 * The Graph API ingests Reels by public `video_url`, so a publicly reachable
 * clip URL is required. With a token and a public URL it creates a media
 * container and (for AUTO) publishes it; otherwise it prepares a local DRAFT.
 * `accountHandle` is expected to be the IG user id for the container calls.
 */
export class InstagramReelsProvider implements PublishProvider {
  readonly platform = "INSTAGRAM_REELS" as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { status: "DRAFTED", note: "Prepared local draft (no Instagram credentials connected)." };
    }
    if (!input.clipUrl) {
      return {
        status: "DRAFTED",
        note: "Instagram ingests by public video_url; publish a public clip URL to post.",
      };
    }

    const igUserId = input.accountHandle;
    const containerResp = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: input.clipUrl,
          caption: input.caption.slice(0, 2200),
          access_token: input.accessToken,
        }),
      },
    );
    if (!containerResp.ok) throw new Error(`IG container failed: ${containerResp.status}`);
    const container = (await containerResp.json()) as { id?: string };
    if (!container.id) throw new Error("IG container returned no id");

    if (input.mode !== "AUTO") {
      return { status: "DRAFTED", externalPostId: container.id, note: "Created Reels container (awaiting publish)." };
    }

    const publishResp = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: container.id, access_token: input.accessToken }),
      },
    );
    if (!publishResp.ok) throw new Error(`IG publish failed: ${publishResp.status}`);
    const published = (await publishResp.json()) as { id?: string };
    logger.info({ mediaId: published.id }, "Instagram Reel published");
    return {
      status: "PUBLISHED",
      externalPostId: published.id,
      postUrl: published.id ? `https://www.instagram.com/reel/${published.id}/` : undefined,
    };
  }
}
