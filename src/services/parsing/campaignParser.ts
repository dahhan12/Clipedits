import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { assertSafeUrl } from "@/lib/security/url";
import { extractStructured } from "@/lib/ai/anthropic";
import { withPersistentContext } from "@/adapters/discovery/browser";
import {
  CampaignRulesSchema,
  type CampaignRules,
} from "@/lib/schemas/campaign";
import { campaignRulesJsonSchema } from "./campaignRulesJsonSchema";

const SYSTEM_PROMPT = `You extract short-form video "Content Rewards" campaign requirements into a strict schema.
Rules:
- Only report what the page states. NEVER invent missing rules — leave unknown fields null/empty.
- For every field you populate, add an evidence excerpt quoting the source text.
- If requirements are unclear or contradictory, list them in "uncertainties" and lower "confidence".
- "confidence" is your overall 0..1 certainty that the extraction is complete and correct.`;

export interface ParsedCampaign {
  rules: CampaignRules;
  raw: unknown;
}

/**
 * Open a campaign page, follow its visible resource/rule links, capture the
 * combined text, and extract a Zod-validated CampaignRules object via Claude.
 *
 * The model's raw output is ALWAYS re-validated with Zod before it can be
 * persisted; invalid output throws rather than entering the database.
 */
export async function parseCampaign(input: {
  campaignId: string;
  sourceUrl: string;
  /** When provided (e.g. manual paste), use this text instead of fetching. */
  pageTextOverride?: string;
}): Promise<ParsedCampaign> {
  let pageText: string;
  if (input.pageTextOverride && input.pageTextOverride.trim().length > 0) {
    pageText = input.pageTextOverride.slice(0, 30_000);
  } else {
    await assertSafeUrl(input.sourceUrl);
    pageText = await capturePageText(input.sourceUrl);
  }

  const raw = await extractStructured<CampaignRules>({
    system: SYSTEM_PROMPT,
    prompt: `Campaign id: ${input.campaignId}\nSource URL: ${input.sourceUrl}\n\nPage content:\n${pageText}`,
    toolName: "record_campaign_rules",
    toolDescription: "Record the extracted, evidence-backed campaign rules.",
    inputSchema: campaignRulesJsonSchema,
    sandboxFallback: sandboxRules(input),
    maxTokens: 4096,
  });

  const validated = CampaignRulesSchema.parse(raw);
  logger.info(
    { campaignId: input.campaignId, confidence: validated.confidence },
    "Campaign parsed and validated",
  );
  return { rules: validated, raw };
}

/** Load the campaign page and its linked resource/rule pages, returning text. */
async function capturePageText(sourceUrl: string): Promise<string> {
  return withPersistentContext(async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const mainText = (await page.innerText("body")).slice(0, 20_000);

    // Follow same-origin resource/rule links to gather extra requirement text.
    const links = await page.$$eval("a[href]", (anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /rule|require|resource|brief|guideline/i.test(h)),
    );

    const extra: string[] = [];
    for (const link of [...new Set(links)].slice(0, 5)) {
      try {
        await assertSafeUrl(link);
        const sub = await ctx.newPage();
        await sub.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
        extra.push(`\n--- ${link} ---\n${(await sub.innerText("body")).slice(0, 8_000)}`);
        await sub.close();
      } catch (err) {
        logger.warn({ err, link }, "Skipped unsafe/unreachable linked resource");
      }
    }
    return [mainText, ...extra].join("\n");
  });
}

/** Deterministic, minimal, low-confidence fallback used in sandbox mode. */
function sandboxRules(input: { campaignId: string; sourceUrl: string }): CampaignRules {
  return CampaignRulesSchema.parse({
    campaignId: input.campaignId,
    title: null,
    sourceUrl: input.sourceUrl,
    status: null,
    budgetTotal: null,
    budgetRemaining: null,
    minPayout: null,
    maxPayout: null,
    minViews: null,
    maxPosts: null,
    deadline: null,
    requiredVideoDurationSec: null,
    requiredAspectRatio: null,
    submissionInstructions: null,
    uncertainties: ["Parsed in sandbox mode without a live model."],
    confidence: 0,
    evidence: [],
  });
}
