import { chromium, type BrowserContext } from "playwright";
import { env } from "@/lib/config/env";

/**
 * Persistent authenticated browser context used by discovery/parsing when an
 * official API is unavailable. State (cookies, storage) lives on disk in a
 * git-ignored directory — never raw passwords.
 */
export async function withPersistentContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await chromium.launchPersistentContext(env.PLAYWRIGHT_STATE_DIR, {
    headless: env.PLAYWRIGHT_HEADLESS,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) CampaignClipper/0.1 Safari/537.36",
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

/** Extract every campaign id from an array of hrefs pointing at /discover/:id. */
export function extractDiscoverIds(hrefs: string[]): Array<{ id: string; url: string }> {
  const out = new Map<string, string>();
  for (const href of hrefs) {
    const m = href.match(/\/discover\/([A-Za-z0-9_-]+)/);
    if (m && m[1]) out.set(m[1], href);
  }
  return [...out.entries()].map(([id, url]) => ({ id, url }));
}
