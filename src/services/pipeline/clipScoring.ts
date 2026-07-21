import { extractStructured } from "@/lib/ai/anthropic";
import { ClipScoresSchema, type ClipScores } from "@/lib/schemas/media";

const scoresJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hookStrength", "clarity", "emotionalIntensity", "campaignRelevance", "standaloneValue", "overall"],
  properties: {
    hookStrength: { type: "number", minimum: 0, maximum: 1 },
    clarity: { type: "number", minimum: 0, maximum: 1 },
    emotionalIntensity: { type: "number", minimum: 0, maximum: 1 },
    campaignRelevance: { type: "number", minimum: 0, maximum: 1 },
    standaloneValue: { type: "number", minimum: 0, maximum: 1 },
    overall: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
  },
} as const;

export interface ScoreClipInput {
  campaignTitle: string | null;
  campaignContext: string;
  transcriptExcerpt: string;
  positionRatio: number; // 0 = start of video, 1 = end
}

/**
 * Score a candidate clip on hook / clarity / emotional intensity / campaign
 * relevance / standalone value via Claude structured output, re-validated with
 * Zod. In sandbox mode a deterministic heuristic (earlier + text-rich = higher)
 * is returned so the pipeline runs offline.
 */
export async function scoreClip(input: ScoreClipInput): Promise<ClipScores> {
  const raw = await extractStructured<ClipScores>({
    system:
      "You rate short-form video clip candidates for repurposing into campaign posts. Score each dimension 0..1. Only use the provided transcript; do not invent content.",
    prompt: `Campaign: ${input.campaignTitle ?? "(untitled)"}\nContext: ${input.campaignContext}\n\nClip transcript:\n${input.transcriptExcerpt}`,
    toolName: "record_clip_scores",
    toolDescription: "Record 0..1 scores for the clip candidate across all dimensions.",
    inputSchema: scoresJsonSchema,
    sandboxFallback: heuristicScores(input),
    maxTokens: 1024,
  });
  return ClipScoresSchema.parse(raw);
}

function heuristicScores(input: ScoreClipInput): ClipScores {
  const richness = Math.min(1, input.transcriptExcerpt.replace(/\[.*?\]/g, "").trim().length / 400);
  const hook = Math.max(0.1, 1 - input.positionRatio * 0.7);
  const overall = Number(((hook + richness + 0.5) / 3).toFixed(3));
  return ClipScoresSchema.parse({
    hookStrength: Number(hook.toFixed(3)),
    clarity: 0.6,
    emotionalIntensity: Number((0.4 + richness * 0.3).toFixed(3)),
    campaignRelevance: 0.5,
    standaloneValue: Number((0.4 + richness * 0.4).toFixed(3)),
    overall,
    rationale: "sandbox heuristic (no live model)",
  });
}
