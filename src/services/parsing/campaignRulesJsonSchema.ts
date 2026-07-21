/**
 * JSON Schema handed to Claude as the tool input schema. It mirrors
 * `CampaignRulesSchema` (Zod). Zod remains the authority — this only shapes the
 * model's output; the result is re-validated with Zod before persistence.
 */

const platform = {
  type: "string",
  enum: ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS", "INSTAGRAM", "YOUTUBE", "X", "OTHER"],
};
const strArray = { type: "array", items: { type: "string" } };
const nullableBool = { type: ["boolean", "null"] };
const nullableNum = { type: ["number", "null"] };

export const campaignRulesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["campaignId", "sourceUrl", "confidence"],
  properties: {
    campaignId: { type: "string" },
    title: { type: ["string", "null"] },
    sourceUrl: { type: "string" },
    status: { type: ["string", "null"] },

    currency: { type: "string", description: "ISO currency code, e.g. USD." },
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
    campaignEndDate: { type: ["string", "null"], description: "ISO-8601, or null." },

    accountEligibility: strArray,
    minimumFollowers: { type: ["integer", "null"] },
    minimumAccountAgeDays: { type: ["integer", "null"] },
    requiredCountries: strArray,
    excludedCountries: strArray,

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
    minimumResolution: { type: ["string", "null"], description: "e.g. '1080x1920'." },
    maximumFileSizeMb: nullableNum,
    requiredFormat: { type: ["string", "null"], description: "e.g. 'mp4'." },
    sourceContentOnly: nullableBool,
    originalEditingRequired: nullableBool,
    subtitlesRequired: nullableBool,
    subtitlesProhibited: nullableBool,
    watermarkRequired: nullableBool,
    sourceContentRestrictions: strArray,
    requiredAudio: strArray,
    requiredHashtags: strArray,
    requiredMentions: strArray,
    requiredCaptions: strArray,
    requiredOverlaysAndLogos: strArray,
    prohibitedContent: strArray,
    prohibitedWords: strArray,
    prohibitedEditingTechniques: strArray,
    contentThemes: strArray,

    repostsAllowed: nullableBool,
    duplicateContentAllowed: nullableBool,
    paidPromotionAllowed: nullableBool,
    postMustRemainLiveDays: { type: ["integer", "null"] },

    submissionMethod: { type: ["string", "null"] },
    publicPostRequired: nullableBool,
    proofRequired: strArray,
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
          purpose: { type: ["string", "null"] },
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
