import type { CampaignRules } from "@/lib/schemas/campaign";

/**
 * Field accessors + comparators for the campaign-parsing evaluation harness.
 *
 * "Correctness" is defined per field with sensible normalisation (sets for
 * arrays, epsilon for numbers, date equality for deadlines). CRITICAL_FIELDS are
 * the ones whose wrongness must never be marked confident/compliant — a wrong
 * critical field is the single most important failure the harness reports.
 */

export type FieldKey =
  | "status"
  | "supportedPlatforms"
  | "budgetTotal"
  | "budgetRemaining"
  | "minPayout"
  | "maxPayout"
  | "minViews"
  | "maxPosts"
  | "deadline"
  | "requiredAspectRatio"
  | "durationMin"
  | "durationMax"
  | "requiredHashtags"
  | "requiredMentions"
  | "requiredCaptions"
  | "requiredOverlaysAndLogos"
  | "requiredAudio"
  | "prohibitedContent"
  | "sourceContentOnly"
  | "submissionMethod";

export const EVALUABLE_FIELDS: FieldKey[] = [
  "status",
  "supportedPlatforms",
  "budgetTotal",
  "budgetRemaining",
  "minPayout",
  "maxPayout",
  "minViews",
  "maxPosts",
  "deadline",
  "requiredAspectRatio",
  "durationMin",
  "durationMax",
  "requiredHashtags",
  "requiredMentions",
  "requiredCaptions",
  "requiredOverlaysAndLogos",
  "requiredAudio",
  "prohibitedContent",
  "sourceContentOnly",
  "submissionMethod",
];

/** Critical fields (a wrong value here must force manual review, never PASS). */
export const CRITICAL_FIELDS: FieldKey[] = [
  "status",
  "supportedPlatforms",
  "deadline",
  "durationMin",
  "durationMax",
  "requiredAspectRatio",
  "requiredAudio",
  "requiredOverlaysAndLogos",
  "requiredMentions",
  "requiredHashtags",
  "maxPosts",
  "submissionMethod",
];

type Value = string | number | boolean | string[] | null;

export function getField(rules: Partial<CampaignRules>, key: FieldKey): Value {
  switch (key) {
    case "durationMin":
      return rules.requiredVideoDurationSec?.min ?? null;
    case "durationMax":
      return rules.requiredVideoDurationSec?.max ?? null;
    default: {
      const v = (rules as Record<string, unknown>)[key];
      if (v === undefined) return null;
      return v as Value;
    }
  }
}

function normTag(s: string): string {
  return s.trim().toLowerCase().replace(/^[#@]/, "");
}

/** Is a value "populated" (a real extracted answer, not absent/empty)? */
export function isPopulated(v: Value): boolean {
  if (v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

export function equalValue(key: FieldKey, a: Value, b: Value): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    const sa = new Set(a.map(normTag));
    const sb = new Set(b.map(normTag));
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
  }
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 0.001);
  }
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;

  const as = String(a).trim();
  const bs = String(b).trim();
  if (key === "deadline") {
    const da = Date.parse(as);
    const db = Date.parse(bs);
    if (!Number.isNaN(da) && !Number.isNaN(db)) return da === db;
  }
  return as.toLowerCase() === bs.toLowerCase();
}
