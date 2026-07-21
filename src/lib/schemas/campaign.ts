import { z } from "zod";

/**
 * The single source of truth for a parsed campaign's rules.
 *
 * Claude extracts campaigns into this exact shape via a tool schema; the raw
 * model output is then re-validated here before anything is persisted. Missing
 * rules are represented as `null`/absent — never invented. Every extracted
 * field is accompanied by an evidence excerpt in `evidence`.
 */

export const PlatformEnum = z.enum([
  "TIKTOK",
  "INSTAGRAM_REELS",
  "YOUTUBE_SHORTS",
  "INSTAGRAM",
  "YOUTUBE",
  "OTHER",
]);
export type CampaignPlatform = z.infer<typeof PlatformEnum>;

export const CampaignRuleStatusEnum = z.enum(["PARSED", "NEEDS_MANUAL_REVIEW"]);

/** CPM keyed by platform, in campaign currency. */
export const CpmByPlatformSchema = z.record(PlatformEnum, z.number().nonnegative());

/** An evidence excerpt tying an extracted field back to source text. */
export const EvidenceSchema = z.object({
  field: z.string(),
  excerpt: z.string(),
  sourceUrl: z.string().url().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const AspectRatioSchema = z
  .string()
  .regex(/^\d{1,2}:\d{1,2}$/, "aspect ratio must look like 9:16");

export const ResourceLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  permittedForDownload: z.boolean().default(false),
});
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;

export const CampaignRulesSchema = z.object({
  // Identity. Unknown fields default to null — the parser never invents them.
  campaignId: z.string().min(1),
  title: z.string().min(1).nullable().default(null),
  sourceUrl: z.string().url(),
  status: z.string().nullable().default(null),

  // Budget
  budgetTotal: z.number().nonnegative().nullable().default(null),
  budgetRemaining: z.number().nonnegative().nullable().default(null),

  // Payouts
  cpmByPlatform: CpmByPlatformSchema.default({}),
  supportedPlatforms: z.array(PlatformEnum).default([]),
  minPayout: z.number().nonnegative().nullable().default(null),
  maxPayout: z.number().nonnegative().nullable().default(null),
  minViews: z.number().int().nonnegative().nullable().default(null),
  maxPosts: z.number().int().nonnegative().nullable().default(null),

  // Timing
  deadline: z.string().datetime({ offset: true }).nullable().default(null),

  // Eligibility
  accountEligibility: z.array(z.string()).default([]),

  // Creative requirements
  requiredVideoDurationSec: z
    .object({ min: z.number().nonnegative().nullable(), max: z.number().nonnegative().nullable() })
    .nullable()
    .default(null),
  requiredAspectRatio: AspectRatioSchema.nullable().default(null),
  sourceContentRestrictions: z.array(z.string()).default([]),
  requiredAudio: z.array(z.string()).default([]),
  requiredHashtags: z.array(z.string()).default([]),
  requiredMentions: z.array(z.string()).default([]),
  requiredCaptions: z.array(z.string()).default([]),
  requiredOverlaysAndLogos: z.array(z.string()).default([]),
  prohibitedContent: z.array(z.string()).default([]),

  // Submission
  submissionInstructions: z.string().nullable().default(null),
  resourceLinks: z.array(ResourceLinkSchema).default([]),

  // Extraction meta
  uncertainties: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).default([]),
});

export type CampaignRules = z.infer<typeof CampaignRulesSchema>;

/**
 * Decide whether a parsed campaign needs a human. Missing rules do not, by
 * themselves, force review — but low confidence or declared contradictions do.
 */
export function deriveRuleStatus(
  rules: CampaignRules,
  confidenceThreshold = 0.6,
): z.infer<typeof CampaignRuleStatusEnum> {
  if (rules.confidence < confidenceThreshold) return "NEEDS_MANUAL_REVIEW";
  if (rules.uncertainties.length > 0) return "NEEDS_MANUAL_REVIEW";
  return "PARSED";
}

/** A campaign observed during discovery, before parsing. */
export const DiscoveredCampaignSchema = z.object({
  source: z.enum(["CONTENT_REWARDS", "WHOP_FORUM"]),
  externalId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().optional(),
  pageHash: z.string().min(1),
  budgetTotal: z.number().nonnegative().nullable().optional(),
  budgetRemaining: z.number().nonnegative().nullable().optional(),
  status: z.string().nullable().optional(),
});
export type DiscoveredCampaign = z.infer<typeof DiscoveredCampaignSchema>;
