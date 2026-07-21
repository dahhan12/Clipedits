import { env } from "@/lib/config/env";
import type { Platform } from "@/generated/prisma";

/**
 * Platform capability gating. Computes what the app can HONESTLY do for a
 * platform right now, so the UI never offers "Publish now" when the provider
 * (or our app's approval status) cannot actually perform a public post.
 *
 * Pure and unit-tested. The publish service uses `maxMode` to downgrade unsafe
 * requests; the dashboard uses `capabilities` + `reasons` to explain gating.
 */

export type Capability =
  | "EXPORT_ONLY"
  | "LOCAL_DRAFT"
  | "PLATFORM_DRAFT"
  | "PRIVATE_UPLOAD"
  | "PUBLIC_UPLOAD"
  | "DIRECT_POST"
  | "SUBMISSION_AUTOMATION"
  | "METRIC_SYNC";

export interface CapabilityInput {
  platform: Platform;
  accountConnected: boolean;
  requiresInAppAudioOrEffects: boolean;
  complianceOutcome: "PASS" | "REVIEW" | "FAIL";
  providerHealthy?: boolean;
  /** Override the platform-audited status (defaults to the env-derived value). */
  audited?: boolean;
}

export interface CapabilityResult {
  capabilities: Capability[];
  /** The strongest publication mode the app may perform now. */
  maxMode: "AUTO" | "DRAFT" | "MANUAL";
  /** Whether a genuine public post is possible (audited + healthy + connected). */
  canPublishPublicly: boolean;
  reasons: string[];
}

function platformAudited(platform: Platform): boolean {
  switch (platform) {
    case "TIKTOK":
      return env.TIKTOK_AUDITED;
    case "INSTAGRAM_REELS":
      return env.INSTAGRAM_APPROVED;
    case "YOUTUBE_SHORTS":
      return env.YOUTUBE_API_VERIFIED;
  }
}

export function computeCapabilities(input: CapabilityInput): CapabilityResult {
  const healthy = input.providerHealthy !== false;
  const caps = new Set<Capability>(["EXPORT_ONLY", "LOCAL_DRAFT"]);
  const reasons: string[] = [];

  // A compliance FAIL blocks every platform action.
  if (input.complianceOutcome === "FAIL") {
    reasons.push("A compliance check FAILed — publishing is blocked.");
    return { capabilities: [...caps], maxMode: "MANUAL", canPublishPublicly: false, reasons };
  }
  if (!input.accountConnected) {
    reasons.push(`No connected ${input.platform} account — only local draft/export is available.`);
    return { capabilities: [...caps], maxMode: "DRAFT", canPublishPublicly: false, reasons };
  }
  if (!healthy) {
    reasons.push(`${input.platform} provider is unhealthy — deferring to draft.`);
    return { capabilities: [...caps], maxMode: "DRAFT", canPublishPublicly: false, reasons };
  }

  caps.add("METRIC_SYNC");
  caps.add("SUBMISSION_AUTOMATION");

  const audited = input.audited ?? platformAudited(input.platform);

  // Campaigns needing official in-app audio/stickers/effects can never be
  // fully automated — they must be finished by a human in the app.
  if (input.requiresInAppAudioOrEffects) {
    reasons.push("Campaign requires official in-app audio/stickers/effects — draft/manual only.");
    caps.add(input.platform === "YOUTUBE_SHORTS" ? "PRIVATE_UPLOAD" : "PLATFORM_DRAFT");
    return { capabilities: [...caps], maxMode: "DRAFT", canPublishPublicly: false, reasons };
  }

  switch (input.platform) {
    case "TIKTOK":
      caps.add("PLATFORM_DRAFT");
      if (audited) {
        caps.add("DIRECT_POST");
        reasons.push("TikTok direct posting requires explicit user confirmation.");
      } else {
        reasons.push("TikTok app is not audited — inbox draft only, no public posting.");
      }
      break;
    case "YOUTUBE_SHORTS":
      caps.add("PRIVATE_UPLOAD");
      if (audited) caps.add("PUBLIC_UPLOAD");
      else reasons.push("YouTube API project is unverified — private uploads only.");
      break;
    case "INSTAGRAM_REELS":
      caps.add("PLATFORM_DRAFT");
      if (audited) caps.add("PUBLIC_UPLOAD");
      else reasons.push("Instagram app is not approved for content publishing — draft only.");
      break;
  }

  const canPublishPublicly =
    caps.has("PUBLIC_UPLOAD") || caps.has("DIRECT_POST");
  // AUTO (public) is only offered when audited AND compliance is clean (PASS).
  const maxMode: CapabilityResult["maxMode"] =
    canPublishPublicly && input.complianceOutcome === "PASS" ? "AUTO" : "DRAFT";
  if (canPublishPublicly && input.complianceOutcome === "REVIEW") {
    reasons.push("Compliance has unresolved REVIEWs — draft until reviewed.");
  }

  return { capabilities: [...caps], maxMode, canPublishPublicly, reasons };
}
