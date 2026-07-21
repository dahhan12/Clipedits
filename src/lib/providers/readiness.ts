import { isSandbox } from "@/lib/config/env";

/**
 * Provider readiness registry. The `status` values mirror
 * docs/PRODUCTION_READINESS_AUDIT.md (the source of truth) and are intentionally
 * conservative. `credentialsPresent` is computed live from the environment so
 * the dashboard shows, honestly, whether a provider is even configured — and
 * never implies a capability the app cannot actually perform.
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
}

export function providerReadiness(): ProviderReadiness[] {
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
