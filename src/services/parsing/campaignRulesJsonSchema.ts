/**
 * JSON Schema handed to Claude as the tool input schema. It mirrors
 * `CampaignRulesSchema` (Zod). Zod remains the authority — this only shapes the
 * model's output; the result is re-validated with Zod before persistence.
 */

const platform = {
  type: "string",
  enum: ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS", "INSTAGRAM", "YOUTUBE", "OTHER"],
};

export const campaignRulesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["campaignId", "sourceUrl", "confidence"],
  properties: {
    campaignId: { type: "string" },
    title: { type: ["string", "null"] },
    sourceUrl: { type: "string" },
    status: { type: ["string", "null"] },

    budgetTotal: { type: ["number", "null"] },
    budgetRemaining: { type: ["number", "null"] },

    cpmByPlatform: {
      type: "object",
      additionalProperties: { type: "number" },
      description: "CPM keyed by platform (TIKTOK, INSTAGRAM_REELS, ...).",
    },
    supportedPlatforms: { type: "array", items: platform },
    minPayout: { type: ["number", "null"] },
    maxPayout: { type: ["number", "null"] },
    minViews: { type: ["integer", "null"] },
    maxPosts: { type: ["integer", "null"] },

    deadline: {
      type: ["string", "null"],
      description: "ISO-8601 datetime with offset, or null if not stated.",
    },

    accountEligibility: { type: "array", items: { type: "string" } },

    requiredVideoDurationSec: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        min: { type: ["number", "null"] },
        max: { type: ["number", "null"] },
      },
    },
    requiredAspectRatio: {
      type: ["string", "null"],
      description: "e.g. '9:16', or null.",
    },
    sourceContentRestrictions: { type: "array", items: { type: "string" } },
    requiredAudio: { type: "array", items: { type: "string" } },
    requiredHashtags: { type: "array", items: { type: "string" } },
    requiredMentions: { type: "array", items: { type: "string" } },
    requiredCaptions: { type: "array", items: { type: "string" } },
    requiredOverlaysAndLogos: { type: "array", items: { type: "string" } },
    prohibitedContent: { type: "array", items: { type: "string" } },

    submissionInstructions: { type: ["string", "null"] },
    resourceLinks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string" },
          label: { type: "string" },
          permittedForDownload: { type: "boolean" },
        },
      },
    },

    uncertainties: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "excerpt"],
        properties: {
          field: { type: "string" },
          excerpt: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
  },
} as const;
