import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { sha256Hex } from "@/lib/security/crypto";
import { assertSafeUrl } from "@/lib/security/url";
import { DiscoveredCampaignSchema, type DiscoveredCampaign } from "@/lib/schemas/campaign";
import type { DiscoveryAdapter } from "./types";
import { extractDiscoverIds, withPersistentContext } from "./browser";

/**
 * ContentRewardsDiscoverAdapter
 *
 * Visits the Content Rewards Discover page, extracts campaign cards and their
 * `/discover/:campaignId` URLs, and computes a per-campaign page hash so
 * revisions (budget/status/requirement drift) can be detected downstream.
 */
export class ContentRewardsDiscoverAdapter implements DiscoveryAdapter {
  readonly name = "content-rewards-discover";

  constructor(
    private readonly baseUrl = env.CONTENT_REWARDS_BASE_URL,
    private readonly discoverPath = env.CONTENT_REWARDS_DISCOVER_PATH,
  ) {}

  async discover(): Promise<DiscoveredCampaign[]> {
    const discoverUrl = new URL(this.discoverPath, this.baseUrl).toString();
    await assertSafeUrl(discoverUrl);

    return withPersistentContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(discoverUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

      // Collect every card and its discover link + a text snapshot for hashing.
      const cards = await page.$$eval("a[href*='/discover/']", (anchors) =>
        anchors.map((a) => {
          const el = a as HTMLAnchorElement;
          const card = el.closest("[data-campaign], article, li, div") ?? el;
          return {
            href: el.href,
            title: (el.textContent ?? "").trim().slice(0, 200) || null,
            snapshot: (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
          };
        }),
      );

      const byId = new Map<string, (typeof cards)[number]>();
      for (const c of cards) {
        const ids = extractDiscoverIds([c.href]);
        const first = ids[0];
        if (first && !byId.has(first.id)) byId.set(first.id, c);
      }

      const results: DiscoveredCampaign[] = [];
      for (const [id, card] of byId) {
        const url = new URL(`/discover/${id}`, this.baseUrl).toString();
        const parsed = DiscoveredCampaignSchema.safeParse({
          source: "CONTENT_REWARDS",
          externalId: id,
          sourceUrl: url,
          title: card.title ?? undefined,
          pageHash: sha256Hex(card.snapshot || url),
        });
        if (parsed.success) results.push(parsed.data);
        else logger.warn({ id, issues: parsed.error.issues }, "Skipping malformed card");
      }

      logger.info({ count: results.length }, "ContentRewards discovery complete");
      return results;
    });
  }
}
