import { extractStructured } from "@/lib/ai/anthropic";
import { z } from "zod";
import type { CampaignRules } from "@/lib/schemas/campaign";
import type { Finding } from "./validators";

const SemanticSchema = z.object({
  outcome: z.enum(["PASS", "FAIL", "REVIEW"]),
  reason: z.string(),
});

/**
 * Semantic compliance check for rules that cannot be decided mechanically —
 * chiefly whether caption/overlay text contains prohibited content. Uses Claude;
 * in sandbox mode it returns PASS when no prohibited-content rules exist and
 * REVIEW otherwise (never a false PASS).
 */
export async function semanticReview(
  rules: CampaignRules,
  captions: Record<string, string>,
  overlays: string[],
): Promise<Finding> {
  if (rules.prohibitedContent.length === 0) {
    return { check: "prohibitedContent", outcome: "PASS", reason: "No prohibited-content rules", deterministic: false };
  }

  const text = [...Object.values(captions), ...overlays].join("\n");
  const raw = await extractStructured<{ outcome: string; reason: string }>({
    system:
      "You check whether the provided post text violates the campaign's prohibited-content rules. Return FAIL if it plausibly violates, REVIEW if uncertain, PASS if clearly compliant. Be conservative.",
    prompt: `Prohibited content rules:\n- ${rules.prohibitedContent.join("\n- ")}\n\nPost text:\n${text}`,
    toolName: "record_semantic_compliance",
    toolDescription: "Record the semantic compliance outcome and reason.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "reason"],
      properties: {
        outcome: { type: "string", enum: ["PASS", "FAIL", "REVIEW"] },
        reason: { type: "string" },
      },
    },
    sandboxFallback: { outcome: "REVIEW", reason: "Semantic prohibited-content check requires a live model" },
    maxTokens: 512,
  });

  const parsed = SemanticSchema.safeParse(raw);
  const value = parsed.success ? parsed.data : { outcome: "REVIEW" as const, reason: "Unparseable semantic result" };
  return { check: "prohibitedContent", outcome: value.outcome, reason: value.reason, deterministic: false };
}
