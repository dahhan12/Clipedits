import { env, isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { sha256Hex } from "@/lib/security/crypto";
import { assertSafeUrl } from "@/lib/security/url";
import { DiscoveredCampaignSchema, type DiscoveredCampaign } from "@/lib/schemas/campaign";
import type { DiscoveryAdapter } from "./types";
import { extractDiscoverIds, withPersistentContext } from "./browser";

/**
 * WhopForumAdapter
 *
 * Primary path: the official Whop Forums API (when WHOP_API_KEY and
 * WHOP_EXPERIENCE_ID are set). Fetches recent forum posts, keeps only those
 * authored by `contentrewardsbot`, and extracts every
 * contentrewards.com/discover link.
 *
 * Fallback path: a Playwright persistent authenticated session that scrapes
 * the same forum. Raw Whop passwords are never stored — only the on-disk
 * browser context and the API key in env.
 */
export class WhopForumAdapter implements DiscoveryAdapter {
  readonly name = "whop-forum";

  async discover(): Promise<DiscoveredCampaign[]> {
    if (!isSandbox.whopApi()) {
      try {
        return await this.discoverViaApi();
      } catch (err) {
        logger.warn({ err }, "Whop API discovery failed; falling back to Playwright");
      }
    }
    return this.discoverViaPlaywright();
  }

  /** Official Whop Forums API. */
  private async discoverViaApi(): Promise<DiscoveredCampaign[]> {
    const url = `https://api.whop.com/api/v5/experiences/${encodeURIComponent(
      env.WHOP_EXPERIENCE_ID!,
    )}/forum_posts?limit=50`;
    await assertSafeUrl(url);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.WHOP_API_KEY}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      throw new Error(`Whop API returned ${resp.status}`);
    }
    const body = (await resp.json()) as {
      data?: Array<{ id?: string; content?: string; user?: { username?: string } }>;
    };
    const posts = body.data ?? [];
    const botPosts = posts.filter(
      (p) => (p.user?.username ?? "").toLowerCase() === env.WHOP_FORUM_BOT_USERNAME.toLowerCase(),
    );
    return this.fromTexts(botPosts.map((p) => p.content ?? ""));
  }

  /** Persistent authenticated Playwright fallback. */
  private async discoverViaPlaywright(): Promise<DiscoveredCampaign[]> {
    const forumUrl = env.WHOP_EXPERIENCE_ID
      ? `https://whop.com/experiences/${env.WHOP_EXPERIENCE_ID}/`
      : "https://whop.com/";
    await assertSafeUrl(forumUrl);

    return withPersistentContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(forumUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const texts = await page.$$eval(
        "[data-post], article, [role='article']",
        (nodes) => nodes.map((n) => (n.textContent ?? "").trim()),
      );
      return this.fromTexts(texts);
    });
  }

  /** Extract contentrewards.com/discover campaigns from raw post text. */
  private fromTexts(texts: string[]): DiscoveredCampaign[] {
    const linkRe = /https?:\/\/(?:www\.)?contentrewards\.com\/discover\/[A-Za-z0-9_-]+/g;
    const hrefs = texts.flatMap((t) => t.match(linkRe) ?? []);
    const ids = extractDiscoverIds(hrefs);

    const results: DiscoveredCampaign[] = [];
    for (const { id, url } of ids) {
      const parsed = DiscoveredCampaignSchema.safeParse({
        source: "WHOP_FORUM",
        externalId: id,
        sourceUrl: url,
        pageHash: sha256Hex(url),
      });
      if (parsed.success) results.push(parsed.data);
    }
    logger.info({ count: results.length }, "Whop forum discovery complete");
    return results;
  }
}
