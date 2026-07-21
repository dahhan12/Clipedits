# CampaignClipper — Production Readiness Audit

**Purpose:** an honest inventory of every external integration and its true
verification status. This is the source of truth for the phrase "production
ready" — the app must never silently fall back from a live provider into a
fabricated success, and no adapter is called production-ready unless it has been
exercised against the real provider.

**Status legend**

| Status | Meaning |
| --- | --- |
| `LIVE_VERIFIED` | Exercised against the real provider; success + failure paths observed. |
| `LIVE_PARTIALLY_VERIFIED` | Some calls exercised against the real provider; not the full surface. |
| `SANDBOX_VERIFIED` | The sandbox/fallback path was run and asserted (no real provider). |
| `IMPLEMENTED_NOT_VERIFIED` | Code written to the documented API but never run against the provider. |
| `FALLBACK_ONLY` | Only a degraded/prepare path exists; the primary path is not implemented. |
| `BLOCKED_BY_CREDENTIALS` | Cannot verify without secrets not present in this environment. |
| `BLOCKED_BY_PLATFORM_APPROVAL` | Requires provider app review/audit before the capability is usable. |

> **Bottom line:** As of this audit, **no external network integration is
> `LIVE_VERIFIED`.** The only components verified end-to-end are local ones:
> PostgreSQL, Redis/BullMQ, the local object store, and the FFmpeg render +
> deterministic compliance path (a real 1080×1920 H.264/AAC render + 21
> compliance checks were executed). Everything that talks to a third-party
> network API is at best `IMPLEMENTED_NOT_VERIFIED` and several are additionally
> `BLOCKED_BY_PLATFORM_APPROVAL`.

---

## Integration matrix

### Content Rewards discovery (Playwright)
- **Status:** `IMPLEMENTED_NOT_VERIFIED`
- **Credentials/scopes:** none (public page) — but the real DOM structure is unknown.
- **Implemented:** loads the Discover page, extracts `a[href*='/discover/']`, derives ids, hashes card text for revision detection.
- **Tested:** `extractDiscoverIds` unit-tested; the scraper itself never run against the real site.
- **Unproven:** the CSS selectors and card structure are assumptions; pagination/auth/anti-bot handling untested.
- **Failure modes:** empty result if selectors don't match; Playwright timeout; blocked by bot protection.
- **Retry:** BullMQ 3× exponential backoff; a bad-selector run "succeeds" with 0 campaigns (needs an alert).
- **Rate limits:** unknown; scraping cadence not throttled per-site.
- **Approval:** none, but ToS review for scraping is the operator's responsibility.

### Whop Forums API
- **Status:** `IMPLEMENTED_NOT_VERIFIED` / `BLOCKED_BY_CREDENTIALS`
- **Credentials/scopes:** `WHOP_API_KEY`, `WHOP_EXPERIENCE_ID`.
- **Implemented:** `GET /api/v5/experiences/{id}/forum_posts`, filter by bot username, extract `contentrewards.com/discover` links.
- **Tested:** none against the API (no key).
- **Unproven:** endpoint path/shape, auth header, pagination, the actual bot username.
- **Failure modes:** 401/403/404; schema drift → 0 links.
- **Retry:** falls back to Playwright on any error.

### Whop Playwright fallback
- **Status:** `IMPLEMENTED_NOT_VERIFIED`
- **Credentials:** persistent authenticated browser profile on disk (no raw passwords stored).
- **Unproven:** login/session bootstrap and forum DOM selectors.

### Anthropic (extraction, scoring, captions, semantic compliance, vision/PDF)
- **Status:** `IMPLEMENTED_NOT_VERIFIED` (live path) / `SANDBOX_VERIFIED` (fallback)
- **Credentials:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- **Implemented:** forced tool-use structured extraction, re-validated with Zod; vision/document text extraction; all re-validated.
- **Tested:** sandbox fallbacks asserted in the render/parse smoke runs. The real Messages API was **not** called in this environment.
- **Unproven:** real extraction quality, tool-schema acceptance by the model, token/latency behaviour, refusal handling. **See §5 — there is no accuracy evaluation yet; "valid Zod output" is not proof of correctness.**
- **Failure modes:** 429 rate limit, 5xx, refusal (no tool_use block → throws), oversized input truncation.
- **Retry:** BullMQ job retry; no in-call backoff for 429 yet.

### Transcription (Whisper-compatible)
- **Status:** `IMPLEMENTED_NOT_VERIFIED` (Whisper) / `SANDBOX_VERIFIED` (sandbox)
- **Credentials:** `WHISPER_API_URL`, `WHISPER_API_KEY`, `WHISPER_MODEL`.
- **Implemented:** `POST /audio/transcriptions` verbose_json with word timestamps, mapped to the Transcript schema; WAV extraction via FFmpeg (verified locally).
- **Unproven:** real API response shape and word-timestamp availability for the chosen backend.

### Google Drive resource ingestion
- **Status:** `FALLBACK_ONLY` (files) / `IMPLEMENTED_NOT_VERIFIED` (download)
- **Implemented:** share-link → `uc?export=download` rewrite for **files**; **folder listing is not implemented** (flagged as needing the Drive API).
- **Unproven:** the rewritten URL actually returns bytes (Drive interstitials/virus-scan pages for large files are not handled).
- **Failure modes:** HTML interstitial instead of the file; quota; permissions.

### Dropbox resource ingestion
- **Status:** `FALLBACK_ONLY` (files) / `IMPLEMENTED_NOT_VERIFIED` (download)
- **Implemented:** `?dl=1` rewrite for **files**; **folder listing not implemented** (needs the Dropbox API).

### YouTube resource ingestion (as a source)
- **Status:** `FALLBACK_ONLY`
- **Implemented:** flagged as requiring `yt-dlp` and express campaign permission; **no downloader implemented.**
- **Note:** downloading YouTube content has significant ToS/rights implications; intentionally left non-functional until a rights-checked path exists.

### Cloudflare R2 (object storage)
- **Status:** `IMPLEMENTED_NOT_VERIFIED` (R2) / `LIVE_VERIFIED` (local sandbox store)
- **Credentials:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
- **Implemented:** S3 put/get + pre-signed URLs; local store used for real in the render smoke test.
- **Unproven:** actual R2 auth/region/endpoint behaviour and pre-signed URL correctness against R2.

### TikTok publishing
- **Status:** `IMPLEMENTED_NOT_VERIFIED` + `BLOCKED_BY_PLATFORM_APPROVAL`
- **Credentials/scopes:** `TIKTOK_CLIENT_KEY/SECRET`, Content Posting API scopes; **direct posting requires TikTok audit**. Unaudited apps are limited to SELF_ONLY / inbox drafts.
- **Implemented:** inbox-draft / direct-post init + file upload; token refresh.
- **Unproven:** the entire real flow; the app must not claim public posting until audited (see §8 capability gating).

### Instagram Reels publishing
- **Status:** `IMPLEMENTED_NOT_VERIFIED` + `BLOCKED_BY_PLATFORM_APPROVAL`
- **Credentials/scopes:** `INSTAGRAM_APP_ID/SECRET`, `instagram_content_publish`, a Business/Creator account, and a **publicly reachable `video_url`**.
- **Unproven:** container/publish flow; the public-URL requirement is not satisfiable from a private dashboard route.

### YouTube Shorts publishing
- **Status:** `IMPLEMENTED_NOT_VERIFIED` + `BLOCKED_BY_PLATFORM_APPROVAL`
- **Credentials/scopes:** `YOUTUBE_CLIENT_ID/SECRET`, `youtube.upload`. **Unverified API projects can only create private/unlisted uploads** and are quota-limited.
- **Unproven:** resumable upload; the private-only limitation must be represented in the UI.

### Campaign submission (Playwright form-fill)
- **Status:** `IMPLEMENTED_NOT_VERIFIED`
- **Implemented:** opens the campaign page, fills a URL input, clicks submit — **selectors are assumptions**; gated behind explicit human confirmation.
- **Unproven:** the real submission form structure; no official API exists.

### Metrics tracking
- **Status:** `IMPLEMENTED_NOT_VERIFIED` (YouTube) / `FALLBACK_ONLY` (TikTok, IG)
- **Implemented:** YouTube Data API `videos?part=statistics` (real structure); TikTok/IG return `null` (no fabricated numbers).
- **Unproven:** YouTube analytics call; TikTok/IG analytics not implemented.

### Earnings tracking
- **Status:** `SANDBOX_VERIFIED` (estimated) / `FALLBACK_ONLY` (confirmed)
- **Implemented:** deterministic estimate from CPM (unit-tested); confirmed earnings/approval/payout come from a status adapter that currently returns "unknown".
- **Unproven:** the Content Rewards portal has no official status API; confirmed earnings require the (unimplemented) Playwright status scrape.

---

## Consequences enforced elsewhere in the codebase
- **Dashboard readiness:** a provider-readiness view surfaces these statuses; see the Providers page and `PlatformCapabilityService` (§8) — publishing actions are gated by real capability, not optimism.
- **No fabricated success:** sandbox modes return honest "unknown"/"prepared draft" states and never synthesise post URLs, view counts, or approvals.

## What would move each to `LIVE_VERIFIED`
1. Real credentials in a staging environment (§15).
2. A recorded successful + failed call per adapter (contract tests against the provider or a faithful recording).
3. For TikTok/IG/YouTube publishing: completing the provider app-review/audit and re-testing.
4. For discovery/submission scrapers: selectors validated against the live pages with golden snapshots.

_Last updated: this hardening pass. Keep this file current — it gates the release report (§18)._
