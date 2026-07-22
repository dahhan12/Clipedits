import { isSandbox } from "@/lib/config/env";
import type { VerificationRecord } from "@/lib/providers/verification";

/**
 * Provider readiness registry. The base `status` values mirror
 * docs/PRODUCTION_READINESS_AUDIT.md (the source of truth) and are intentionally
 * conservative. `credentialsPresent` is computed live from the environment so
 * the dashboard shows, honestly, whether a provider is even configured — and
 * never implies a capability the app cannot actually perform.
 *
 * A provider only advances to LIVE_VERIFIED when `npm run verify:live` has
 * recorded a real passing smoke check (see verification.ts) — never on
 * credential presence alone. Pass the stored records to `providerReadiness()`
 * to reflect them; with no records the board shows the conservative base state.
 */

export type ReadinessStatus =
  | "LIVE_VERIFIED"
  | "LIVE_PARTIALLY_VERIFIED"
  | "SANDBOX_VERIFIED"
  | "IMPLEMENTED_NOT_VERIFIED"
  | "FALLBACK_ONLY"
  | "BLOCKED_BY_CREDENTIALS"
  | "BLOCKED_BY_PLATFORM_APPROVAL";

export interface ProviderReadiness {
  key: string;
  name: string;
  category: "discovery" | "ai" | "media" | "storage" | "publishing" | "submission" | "metrics";
  status: ReadinessStatus;
  credentialsPresent: boolean;
  requiresApproval?: boolean;
  note: string;
  /** ISO timestamp of the last `verify:live` check for this provider, if any. */
  lastVerifiedAt?: string;
}

/**
 * Apply stored verification records to the conservative base list. A positive
 * record promotes the provider to LIVE_VERIFIED; a negative record leaves the
 * base status (still unverified) but surfaces the failure detail and timestamp.
 * Pure — no I/O — so it is fully unit-testable.
 */
export function applyVerifications(
  base: ProviderReadiness[],
  verifications: Record<string, VerificationRecord>,
): ProviderReadiness[] {
  return base.map((p) => {
    const rec = verifications[p.key];
    if (!rec) return p;
    if (rec.ok) {
      return {
        ...p,
        status: "LIVE_VERIFIED",
        lastVerifiedAt: rec.at,
        note: `Live-verified ${rec.at}: ${rec.detail}`,
      };
    }
    return { ...p, lastVerifiedAt: rec.at, note: `Last live check FAILED (${rec.at}): ${rec.detail}. ${p.note}` };
  });
}

export function providerReadiness(
  verifications: Record<string, VerificationRecord> = {},
): ProviderReadiness[] {
  return applyVerifications(baseReadiness(), verifications);
}

function baseReadiness(): ProviderReadiness[] {
  return [
    {
      key: "content-rewards",
      name: "Content Rewards discovery",
      category: "discovery",
      status: "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: true,
      note: "Playwright scraper; DOM selectors unverified against the live site.",
    },
    {
      key: "whop-api",
      name: "Whop Forums API",
      category: "discovery",
      status: isSandbox.whopApi() ? "BLOCKED_BY_CREDENTIALS" : "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: !isSandbox.whopApi(),
      note: "Needs WHOP_API_KEY + WHOP_EXPERIENCE_ID; endpoint shape unverified.",
    },
    {
      key: "anthropic",
      name: "Anthropic (parse/score/vision)",
      category: "ai",
      status: isSandbox.anthropic() ? "SANDBOX_VERIFIED" : "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: !isSandbox.anthropic(),
      note: "Structured output re-validated with Zod. Accuracy not yet evaluated (see AI_EVALUATION.md).",
    },
    {
      key: "whisper",
      name: "Transcription (Whisper)",
      category: "media",
      status: isSandbox.whisper() ? "SANDBOX_VERIFIED" : "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: !isSandbox.whisper(),
      note: "Word-level Whisper when configured; else deterministic sandbox transcript.",
    },
    {
      key: "google-drive",
      name: "Google Drive ingestion",
      category: "media",
      status: "FALLBACK_ONLY",
      credentialsPresent: true,
      note: "File share-link rewrite only; folder listing + interstitial handling not implemented.",
    },
    {
      key: "dropbox",
      name: "Dropbox ingestion",
      category: "media",
      status: "FALLBACK_ONLY",
      credentialsPresent: true,
      note: "File share-link rewrite only; folder listing not implemented.",
    },
    {
      key: "youtube-source",
      name: "YouTube source ingestion",
      category: "media",
      status: "FALLBACK_ONLY",
      credentialsPresent: false,
      note: "Intentionally non-functional pending a rights-checked path.",
    },
    {
      key: "r2",
      name: "Cloudflare R2 storage",
      category: "storage",
      status: isSandbox.r2() ? "SANDBOX_VERIFIED" : "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: !isSandbox.r2(),
      note: isSandbox.r2() ? "Using local sandbox store (verified)." : "R2 configured; pre-signed URLs unverified against R2.",
    },
    {
      key: "tiktok",
      name: "TikTok publishing",
      category: "publishing",
      status: "BLOCKED_BY_PLATFORM_APPROVAL",
      credentialsPresent: !isSandbox.tiktok(),
      requiresApproval: true,
      note: "Direct posting requires TikTok audit; unaudited = SELF_ONLY/inbox draft only.",
    },
    {
      key: "instagram",
      name: "Instagram Reels publishing",
      category: "publishing",
      status: "BLOCKED_BY_PLATFORM_APPROVAL",
      credentialsPresent: !isSandbox.instagram(),
      requiresApproval: true,
      note: "Needs content-publish review, a Business/Creator account and a public video_url.",
    },
    {
      key: "youtube",
      name: "YouTube Shorts publishing",
      category: "publishing",
      status: "BLOCKED_BY_PLATFORM_APPROVAL",
      credentialsPresent: !isSandbox.youtube(),
      requiresApproval: true,
      note: "Unverified API projects can only create private uploads.",
    },
    {
      key: "submission",
      name: "Campaign submission",
      category: "submission",
      status: "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: true,
      note: "Playwright form-fill; selectors unverified; gated behind human confirmation.",
    },
    {
      key: "metrics",
      name: "Metrics tracking",
      category: "metrics",
      status: "IMPLEMENTED_NOT_VERIFIED",
      credentialsPresent: !isSandbox.youtube(),
      note: "YouTube stats implemented; TikTok/IG return unknown (never fabricated).",
    },
  ];
}
