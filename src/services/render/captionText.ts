import { extractStructured } from "@/lib/ai/anthropic";
import type { CampaignRules, CampaignPlatform } from "@/lib/schemas/campaign";
import { z } from "zod";

const HookSchema = z.object({ hook: z.string().min(1).max(300) });

/**
 * Build a platform-specific caption. The creative opening line comes from
 * Claude (deterministic fallback in sandbox), then mandatory mentions,
 * hashtags and required caption phrases are appended deterministically so the
 * compliance engine always finds them — the model can never omit a required
 * element.
 */
export async function buildCaption(
  platform: CampaignPlatform,
  rules: CampaignRules,
  transcriptExcerpt: string,
): Promise<string> {
  const hook = await creativeHook(rules, transcriptExcerpt);

  const parts: string[] = [hook.trim()];
  for (const phrase of rules.requiredCaptions) parts.push(phrase);
  const mentions = rules.requiredMentions.map((m) => (m.startsWith("@") ? m : `@${m}`));
  const hashtags = rules.requiredHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));

  if (mentions.length) parts.push(mentions.join(" "));
  if (hashtags.length) parts.push(hashtags.join(" "));

  // YouTube Shorts benefit from an explicit #Shorts marker.
  if (platform === "YOUTUBE_SHORTS" && !hashtags.some((h) => /#shorts/i.test(h))) {
    parts.push("#Shorts");
  }
  return parts.join("\n").trim();
}

async function creativeHook(rules: CampaignRules, transcriptExcerpt: string): Promise<string> {
  const fallback = rules.title ?? "Watch this 👀";
  const raw = await extractStructured<{ hook: string }>({
    system:
      "Write a single punchy, non-clickbait opening caption line for a short-form clip. No hashtags or mentions — those are added separately. Keep it under 200 characters and truthful to the transcript.",
    prompt: `Campaign: ${rules.title ?? "(untitled)"}\nProhibited: ${rules.prohibitedContent.join("; ") || "none"}\nTranscript:\n${transcriptExcerpt.slice(0, 1500)}`,
    toolName: "record_caption_hook",
    toolDescription: "Record the single-line caption hook.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["hook"],
      properties: { hook: { type: "string" } },
    },
    sandboxFallback: { hook: fallback },
    maxTokens: 256,
  });
  const parsed = HookSchema.safeParse(raw);
  return parsed.success ? parsed.data.hook : fallback;
}
