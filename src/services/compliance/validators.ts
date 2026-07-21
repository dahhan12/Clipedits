import type { CampaignRules, CampaignPlatform } from "@/lib/schemas/campaign";
import type { AppliedOverlay } from "@/lib/schemas/render";

/**
 * Deterministic compliance validators. Each is a pure function returning a
 * finding with PASS / FAIL / REVIEW and a human reason. Anything that cannot be
 * decided from the available data returns REVIEW (never a false PASS). Semantic
 * rules that need judgement are handled separately by the Claude reviewer.
 */

export type Outcome = "PASS" | "FAIL" | "REVIEW";

export interface Finding {
  check: string;
  outcome: Outcome;
  reason: string;
  deterministic: boolean;
}

const f = (check: string, outcome: Outcome, reason: string): Finding => ({
  check,
  outcome,
  reason,
  deterministic: true,
});

export interface ComplianceContext {
  rules: CampaignRules;
  campaignStatus: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  bytes: number | null;
  overlaysApplied: AppliedOverlay[];
  captions: Record<string, string>;
  originalSource: string;
  // Rights/provenance outcome for the applied transformations + target platforms.
  sourcePermission: { outcome: Outcome; reason: string };
  publicationCount: number;
  duplicate: boolean;
  duplicateCaption: boolean;
  // Perceptual/audio near-duplicate against an already-published clip in this
  // campaign, if any (see perceptualHash detection). null = not evaluated.
  perceptualDuplicate: { renderedClipId: string; videoDistance: number; audioMatch: boolean } | null;
  publicVerified: boolean | null;
  targetPlatforms: CampaignPlatform[];
  now: Date;
}

export function checkDuration(ctx: ComplianceContext): Finding {
  const req = ctx.rules.requiredVideoDurationSec;
  if (ctx.durationSec == null) return f("duration", "REVIEW", "Rendered duration unknown");
  if (!req || (req.min == null && req.max == null)) return f("duration", "PASS", "No duration requirement");
  if (req.min != null && ctx.durationSec < req.min)
    return f("duration", "FAIL", `Duration ${ctx.durationSec.toFixed(1)}s below min ${req.min}s`);
  if (req.max != null && ctx.durationSec > req.max)
    return f("duration", "FAIL", `Duration ${ctx.durationSec.toFixed(1)}s above max ${req.max}s`);
  return f("duration", "PASS", `Duration ${ctx.durationSec.toFixed(1)}s within bounds`);
}

export function checkDimensions(ctx: ComplianceContext): Finding {
  if (ctx.width == null || ctx.height == null) return f("dimensions", "REVIEW", "Dimensions unknown");
  if (ctx.width <= 0 || ctx.height <= 0) return f("dimensions", "FAIL", "Non-positive dimensions");
  return f("dimensions", "PASS", `${ctx.width}x${ctx.height}`);
}

export function checkAspectRatio(ctx: ComplianceContext): Finding {
  if (ctx.width == null || ctx.height == null) return f("aspectRatio", "REVIEW", "Dimensions unknown");
  const required = ctx.rules.requiredAspectRatio ?? "9:16";
  const [rw, rh] = required.split(":").map(Number);
  if (!rw || !rh) return f("aspectRatio", "REVIEW", `Unparseable required ratio ${required}`);
  const actual = ctx.width / ctx.height;
  const target = rw / rh;
  const ok = Math.abs(actual - target) / target <= 0.02;
  return ok
    ? f("aspectRatio", "PASS", `Matches ${required}`)
    : f("aspectRatio", "FAIL", `Aspect ${ctx.width}:${ctx.height} != required ${required}`);
}

export function checkFileFormat(ctx: ComplianceContext): Finding {
  const okContainer = (ctx.container ?? "").includes("mp4") || (ctx.container ?? "").includes("mov");
  const okVideo = (ctx.videoCodec ?? "") === "h264";
  const okAudio = ctx.audioCodec == null || ctx.audioCodec === "aac";
  if (ctx.container == null && ctx.videoCodec == null) return f("fileFormat", "REVIEW", "Format unknown");
  return okContainer && okVideo && okAudio
    ? f("fileFormat", "PASS", `mp4/h264/${ctx.audioCodec ?? "no-audio"}`)
    : f("fileFormat", "FAIL", `Format ${ctx.container}/${ctx.videoCodec}/${ctx.audioCodec} not mp4/h264/aac`);
}

export function checkSourcePermission(ctx: ComplianceContext): Finding {
  return f("sourcePermission", ctx.sourcePermission.outcome, ctx.sourcePermission.reason);
}

export function checkSourceEligibility(ctx: ComplianceContext): Finding {
  const s = ctx.originalSource.toLowerCase();
  for (const r of ctx.rules.sourceContentRestrictions) {
    if (/no youtube/i.test(r) && /youtube|youtu\.be/.test(s))
      return f("sourceEligibility", "FAIL", `Source violates restriction: ${r}`);
  }
  return f("sourceEligibility", "PASS", "Source not disallowed by restrictions");
}

export function checkMandatoryOverlays(ctx: ComplianceContext): Finding {
  const required = ctx.rules.requiredOverlaysAndLogos;
  if (required.length === 0) return f("mandatoryOverlays", "PASS", "No mandatory overlays");
  const applied = new Set(ctx.overlaysApplied.map((o) => o.value.toLowerCase()));
  const missing = required.filter((r) => !applied.has(r.toLowerCase()));
  return missing.length === 0
    ? f("mandatoryOverlays", "PASS", "All mandatory overlays applied")
    : f("mandatoryOverlays", "FAIL", `Missing overlays: ${missing.join(", ")}`);
}

function everyCaptionContains(captions: Record<string, string>, needle: string): boolean {
  const values = Object.values(captions);
  if (values.length === 0) return false;
  return values.every((c) => c.toLowerCase().includes(needle.toLowerCase()));
}

export function checkMandatoryText(ctx: ComplianceContext): Finding {
  const required = ctx.rules.requiredCaptions;
  if (required.length === 0) return f("mandatoryText", "PASS", "No mandatory text");
  const appliedText = ctx.overlaysApplied.filter((o) => o.kind === "CAPTION" || o.kind === "TEXT").map((o) => o.value.toLowerCase());
  const missing = required.filter(
    (r) => !appliedText.some((t) => t.includes(r.toLowerCase())) && !everyCaptionContains(ctx.captions, r),
  );
  return missing.length === 0
    ? f("mandatoryText", "PASS", "All mandatory text present")
    : f("mandatoryText", "FAIL", `Missing required text: ${missing.join(", ")}`);
}

export function checkMandatoryMentions(ctx: ComplianceContext): Finding {
  const required = ctx.rules.requiredMentions.map((m) => (m.startsWith("@") ? m : `@${m}`));
  if (required.length === 0) return f("mandatoryMentions", "PASS", "No mandatory mentions");
  if (Object.keys(ctx.captions).length === 0) return f("mandatoryMentions", "REVIEW", "No captions to check");
  const missing = required.filter((m) => !everyCaptionContains(ctx.captions, m));
  return missing.length === 0
    ? f("mandatoryMentions", "PASS", "All mandatory mentions present")
    : f("mandatoryMentions", "FAIL", `Missing mentions: ${missing.join(", ")}`);
}

export function checkMandatoryHashtags(ctx: ComplianceContext): Finding {
  const required = ctx.rules.requiredHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
  if (required.length === 0) return f("mandatoryHashtags", "PASS", "No mandatory hashtags");
  if (Object.keys(ctx.captions).length === 0) return f("mandatoryHashtags", "REVIEW", "No captions to check");
  const missing = required.filter((h) => !everyCaptionContains(ctx.captions, h));
  return missing.length === 0
    ? f("mandatoryHashtags", "PASS", "All mandatory hashtags present")
    : f("mandatoryHashtags", "FAIL", `Missing hashtags: ${missing.join(", ")}`);
}

export function checkPlatformEligibility(ctx: ComplianceContext): Finding {
  const supported = ctx.rules.supportedPlatforms;
  if (supported.length === 0) return f("platformEligibility", "REVIEW", "Campaign lists no supported platforms");
  if (ctx.targetPlatforms.length === 0) return f("platformEligibility", "REVIEW", "No target platforms selected");
  const ineligible = ctx.targetPlatforms.filter((p) => !supported.includes(p));
  return ineligible.length === 0
    ? f("platformEligibility", "PASS", `Targets within ${supported.join(", ")}`)
    : f("platformEligibility", "FAIL", `Ineligible platforms: ${ineligible.join(", ")}`);
}

export function checkDeadline(ctx: ComplianceContext): Finding {
  if (!ctx.rules.deadline) return f("deadline", "PASS", "No deadline");
  const dl = new Date(ctx.rules.deadline);
  if (Number.isNaN(dl.getTime())) return f("deadline", "REVIEW", "Unparseable deadline");
  return dl.getTime() >= ctx.now.getTime()
    ? f("deadline", "PASS", `Before deadline ${ctx.rules.deadline}`)
    : f("deadline", "FAIL", `Past deadline ${ctx.rules.deadline}`);
}

export function checkMaxPosts(ctx: ComplianceContext): Finding {
  const max = ctx.rules.maxPosts;
  if (max == null) return f("maxPosts", "PASS", "No max-post limit");
  return ctx.publicationCount < max
    ? f("maxPosts", "PASS", `${ctx.publicationCount}/${max} posts used`)
    : f("maxPosts", "FAIL", `Max posts reached (${ctx.publicationCount}/${max})`);
}

export function checkDuplicate(ctx: ComplianceContext): Finding {
  return ctx.duplicate
    ? f("duplicateContent", "FAIL", "An equivalent clip was already published for this campaign")
    : f("duplicateContent", "PASS", "No duplicate detected");
}

export function checkPerceptualDuplicate(ctx: ComplianceContext): Finding {
  const d = ctx.perceptualDuplicate;
  if (!d) return f("perceptualDuplicate", "PASS", "No perceptual near-duplicate detected");
  const pct = (d.videoDistance * 100).toFixed(1);
  return f(
    "perceptualDuplicate",
    "FAIL",
    `Near-duplicate of already-published clip ${d.renderedClipId} (video ${pct}% diff${d.audioMatch ? ", audio match" : ""})`,
  );
}

export function checkCampaignStatus(ctx: ComplianceContext): Finding {
  const ok = ["ACTIVE", "PARSED", "DISCOVERED"];
  const bad = ["CLOSED", "PAUSED", "ERROR"];
  if (bad.includes(ctx.campaignStatus)) return f("campaignStatus", "FAIL", `Campaign is ${ctx.campaignStatus}`);
  if (ctx.campaignStatus === "NEEDS_MANUAL_REVIEW") return f("campaignStatus", "REVIEW", "Campaign needs manual review");
  return ok.includes(ctx.campaignStatus)
    ? f("campaignStatus", "PASS", `Campaign ${ctx.campaignStatus}`)
    : f("campaignStatus", "REVIEW", `Unknown campaign status ${ctx.campaignStatus}`);
}

export function checkRemainingBudget(ctx: ComplianceContext): Finding {
  const rem = ctx.rules.budgetRemaining;
  if (rem == null) return f("remainingBudget", "REVIEW", "Remaining budget unknown");
  return rem > 0 ? f("remainingBudget", "PASS", `Budget remaining ${rem}`) : f("remainingBudget", "FAIL", "No remaining budget");
}

export function checkFileSize(ctx: ComplianceContext): Finding {
  const maxMb = ctx.rules.maximumFileSizeMb;
  if (maxMb == null) return f("fileSize", "PASS", "No file-size limit");
  if (ctx.bytes == null) return f("fileSize", "REVIEW", "Rendered file size unknown");
  const mb = ctx.bytes / (1024 * 1024);
  return mb <= maxMb
    ? f("fileSize", "PASS", `${mb.toFixed(1)}MB within ${maxMb}MB`)
    : f("fileSize", "FAIL", `${mb.toFixed(1)}MB exceeds ${maxMb}MB`);
}

export function checkProhibitedWords(ctx: ComplianceContext): Finding {
  const words = ctx.rules.prohibitedWords;
  if (words.length === 0) return f("prohibitedWords", "PASS", "No prohibited words");
  const haystack = [...Object.values(ctx.captions), ...ctx.overlaysApplied.map((o) => o.value)]
    .join(" ")
    .toLowerCase();
  const hits = words.filter((w) => new RegExp(`\\b${escapeRe(w.toLowerCase())}\\b`).test(haystack));
  return hits.length === 0
    ? f("prohibitedWords", "PASS", "No prohibited words present")
    : f("prohibitedWords", "FAIL", `Contains prohibited words: ${hits.join(", ")}`);
}

export function checkDuplicateCaption(ctx: ComplianceContext): Finding {
  return ctx.duplicateCaption
    ? f("duplicateCaption", "FAIL", "An identical caption was already used for this campaign")
    : f("duplicateCaption", "PASS", "No duplicate caption detected");
}

export function checkMinimumAccountRequirements(ctx: ComplianceContext): Finding {
  const r = ctx.rules;
  const hasReq =
    r.minimumFollowers != null ||
    r.minimumAccountAgeDays != null ||
    r.requiredCountries.length > 0 ||
    r.excludedCountries.length > 0 ||
    r.accountEligibility.length > 0;
  if (!hasReq) return f("minimumAccountRequirements", "PASS", "No account requirements");
  // The connected account's follower/age/country data is not available to the
  // deterministic layer, so surface for human confirmation rather than guessing.
  return f("minimumAccountRequirements", "REVIEW", "Account requirements exist; verify the posting account manually");
}

export function checkPublicPostRequirement(ctx: ComplianceContext): Finding {
  if (ctx.rules.publicPostRequired !== true) return f("publicPostRequirement", "PASS", "Public post not required");
  if (ctx.publicVerified === true) return f("publicPostRequirement", "PASS", "Post verified publicly accessible");
  if (ctx.publicVerified === false) return f("publicPostRequirement", "FAIL", "Post is not publicly accessible");
  return f("publicPostRequirement", "REVIEW", "Public post required; accessibility not yet verified");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Run every deterministic validator and return all findings. */
export function runDeterministicChecks(ctx: ComplianceContext): Finding[] {
  return [
    checkDuration(ctx),
    checkDimensions(ctx),
    checkAspectRatio(ctx),
    checkFileFormat(ctx),
    checkSourcePermission(ctx),
    checkSourceEligibility(ctx),
    checkMandatoryOverlays(ctx),
    checkMandatoryText(ctx),
    checkMandatoryMentions(ctx),
    checkMandatoryHashtags(ctx),
    checkPlatformEligibility(ctx),
    checkDeadline(ctx),
    checkMaxPosts(ctx),
    checkDuplicate(ctx),
    checkDuplicateCaption(ctx),
    checkPerceptualDuplicate(ctx),
    checkCampaignStatus(ctx),
    checkRemainingBudget(ctx),
    checkFileSize(ctx),
    checkProhibitedWords(ctx),
    checkMinimumAccountRequirements(ctx),
    checkPublicPostRequirement(ctx),
  ];
}

/** Roll up findings into a single outcome (FAIL > REVIEW > PASS). */
export function overallOutcome(findings: Finding[]): Outcome {
  if (findings.some((x) => x.outcome === "FAIL")) return "FAIL";
  if (findings.some((x) => x.outcome === "REVIEW")) return "REVIEW";
  return "PASS";
}
