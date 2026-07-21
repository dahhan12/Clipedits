# Gap Analysis — spec (`REQUIREMENTS.md`) vs. current implementation

This maps the full specification in [`REQUIREMENTS.md`](./REQUIREMENTS.md) to
what is implemented today (Phases 1–5, see [`ARCHITECTURE.md`](./ARCHITECTURE.md)).
Legend: ✅ done · 🟡 partial · ⬜ not yet.

## Core workflow & principles

| Requirement | Status | Notes |
| --- | --- | --- |
| Discovery → parse → download → clip → render → compliance → approve → publish → submit → track | ✅ | End-to-end pipeline across 5 workers, all idempotent `JobRun`s |
| Campaign page is source of truth (Whop = discovery only) | ✅ | `WhopForumAdapter` yields links; parser opens the CR page |
| Claude returns validated structured data (never free-form) | ✅ | Tool schema → re-validated with Zod before persist |
| Never invent missing rules → `NEEDS_MANUAL_REVIEW` | ✅ | `deriveRuleStatus`; unknown fields stay null |
| Deterministic checks before AI | ✅ | 15 deterministic validators + 1 semantic |
| Human approval before publish | ✅ | Approval queue; publish blocked on FAIL |

## Campaign discovery

| Item | Status | Notes |
| --- | --- | --- |
| Content Rewards Discover adapter (cards, ids, page hash, revisions) | ✅ | `ContentRewardsDiscoverAdapter` |
| Whop community adapter (API + Playwright fallback, bot filter) | ✅ | `WhopForumAdapter` |
| Store post text + timestamp as discovery evidence | 🟡 | Revision snapshot stored; raw Whop post text not persisted per-post |
| **Manual campaign entry** (paste URL/text) | ✅ | `MANUAL` source, `manualEntryService`, `/api/campaigns/manual`, `ManualCampaignForm`; pasted text parsed directly. Screenshot/document upload still ⬜ |

## Campaign schema (`CampaignRules`)

| Item | Status | Notes |
| --- | --- | --- |
| Zod-validated, evidence per field, confidence, uncertainties/contradictions | ✅ | `src/lib/schemas/campaign.ts` |
| **Nested shape** (payout{}, deadlines{}, eligibility{}, videoRules{}, contentRules{}, postingRules{}, submissionRules{}) | 🟡 | Current schema is **flat** and covers most fields, but not 1:1 with the nested spec |
| Missing fields | 🟡 | `currency`, `minimumResolution`, `maximumFileSizeMb`, `requiredFormat`, `originalEditingRequired`, `subtitlesRequired/Prohibited`, `watermarkRequired`, `prohibitedWords`, `prohibitedEditingTechniques`, `contentThemes`, `reposts/duplicate/paidPromotion Allowed`, `postMustRemainLiveDays`, `min followers/account age`, `required/excluded countries`, `resource.purpose`, platform `X` |
| Confidence thresholds 0.90 / 0.75 (three-band) | 🟡 | Single 0.6 threshold today |

## Resource ingestion

| Item | Status | Notes |
| --- | --- | --- |
| Direct video, Google Drive, Dropbox, YouTube (permitted only) | ✅ | Resolvers + download service |
| SSRF guard, size cap, MIME/type allowlist, reject executables | ✅ | `security/url.ts` + download service |
| Images / logos / PDFs / caption templates | ⬜ | Only video kinds ingested today (others classified, not downloaded) |
| Signed storage URLs | 🟡 | Served via authenticated app route; no R2 pre-signed URLs yet |

## Video pipeline

| Item | Status | Notes |
| --- | --- | --- |
| Transcription (timestamped) | 🟡 | Segment-level sandbox transcriber; **word-level Whisper** + speaker changes ⬜ |
| Scene detection | ✅ | ffmpeg scene filter |
| Candidate generation within duration limits | ✅ | Scene-aligned; **sentence-boundary/hook awareness** 🟡 (uses transcript ranges, not NLP sentence cuts) |
| Scoring (hook/clarity/emotion/relevance/standalone) | ✅ | Claude + heuristic fallback |
| **Weighted formula incl. visualQuality (0.10)** | 🟡 | 5 dims stored; exact weighting + `visualQuality` not applied |
| Render 9:16 H.264/AAC + manifest | ✅ | FFmpeg + optional Remotion; Zod manifest |
| **Face-aware crop, animated captions, audio normalize, silence trim, thumbnail** | ⬜ | Basic crop + burn-in only |

## Compliance

| Item | Status | Notes |
| --- | --- | --- |
| Deterministic validators (status, deadline, platform, posts, duration, dims, aspect, format, source, logo/overlay/mention/hashtag/caption, prohibited, duplicate, budget) | ✅ | 15 validators |
| `file size`, `duplicate caption`, `prohibited words`, `minimum account requirements`, `public post requirement` | ⬜ | Not yet distinct checks |
| Semantic validators (Claude) | ✅ | Prohibited-content check |
| Re-run compliance immediately before publishing | 🟡 | Gate reads stored results; no fresh re-run at publish time |
| PASS/FAIL/REVIEW + reason; FAIL blocks; REVIEW needs approval/override | ✅ | Enforced in publish service |

## Publishing & submission

| Item | Status | Notes |
| --- | --- | --- |
| TikTok / IG Reels / YouTube adapters; AUTO/DRAFT/MANUAL | ✅ | Official APIs; local DRAFT fallback |
| `PublishingProvider` full interface (validateAccount, getStatus, getMetrics, uploadDraft) | 🟡 | `publish` implemented; the other methods ⬜ |
| Encrypted OAuth tokens, never in logs/client | ✅ | AES-256-GCM |
| Default DRAFT/MANUAL for in-app audio/stickers/effects | 🟡 | Audio/effects detected; stickers/collab/product-tag/branded-toggle heuristics ⬜ |
| Submission: post URL/id, verify public, API-or-Playwright, confirm-before-submit | ✅ | Playwright fallback + confirmation gate |
| Poll for approval/rejection; qualifying views; estimated + **confirmed** earnings; payout status | 🟡 | Estimated earnings ✅; approval polling, confirmed earnings, payout status ⬜ |

## Data model

| Item | Status | Notes |
| --- | --- | --- |
| Campaign, CampaignRevision, CampaignRule, CampaignResource, SourceAsset, ClipCandidate, RenderedClip, ComplianceResult, SocialAccount, Publication, CampaignSubmission, JobRun, AuditEvent | ✅ | 13 models |
| **User, Workspace** (multi-tenant) | ⬜ | RBAC is header-based; no user/workspace tables |
| **CampaignEvidence, Transcript, TranscriptSegment, RenderManifest** as tables | 🟡 | Stored as JSON on parent rows, not separate models |
| **PostMetric, EarningsRecord, EncryptedCredential** | ⬜ / 🟡 | Metrics/earnings history ⬜; credentials stored on `SocialAccount` |
| UUID primary keys | 🟡 | Uses `cuid()` (collision-safe, not RFC-UUID) |
| Idempotency keys, revisions-not-overwrite, audit history | ✅ | |
| Soft-delete | ⬜ | Hard deletes today |

## Jobs, dashboard, security, misc

| Item | Status | Notes |
| --- | --- | --- |
| BullMQ queues | 🟡 | Have discovery/parse/ingest/transcribe/clip/render/compliance/publish/submit/track; **revision-check, scene-detection (own queue), metrics-sync, earnings-sync, cleanup** ⬜ |
| Retries, backoff, attempts, error capture, audit | ✅ | |
| Dashboard pages (campaigns, rules, assets, candidates, preview, compliance, queue, publications, submissions, earnings, jobs) | ✅ | 11 pages |
| **Rule review screen with manual correction → new revision** | ✅ | `RuleEditor` + `/api/campaigns/[id]/rules` + `ruleReviewService`; edits saved as a separate reviewed revision |
| **Compare revisions** action | ✅ | `/campaigns/[id]/revisions` lists rule revisions and diffs the two most recent |
| Tailwind CSS | ⬜ | Hand-rolled CSS (`globals.css`) instead of Tailwind |
| Profitability / priority scoring | ⬜ | Not built |
| Security: SSRF, encryption, redaction, RBAC, audit, env validation, worker timeouts | ✅ | |
| Security: **CSRF, rate limiting, secure cookies, signed storage URLs, session encryption, DB backups** | ⬜ | Not yet |
| Tests: unit (URL/schema/ranges/compliance/earnings) | ✅ | 37 tests |
| Tests: **integration test for idempotent ingestion** | ⬜ | |
| Repo layout: **pnpm monorepo (apps/web + apps/worker + packages/*)** | 🟡 | Single Next app with `src/` modules + `tsx` workers (functionally equivalent) |

## Status: full-parity pass complete

All items from the original next-steps list have been implemented:

1. ✅ **Schema enrichment** — added the missing fields (currency, countries, followers/age, resolution, file size, format, subtitles/watermark flags, prohibited words/editing, content themes, posting rules, submission rules, resource purpose, `X` platform) and the three-band confidence tiers (0.90 / 0.75). *(Kept the flat shape as a comprehensive superset rather than restructuring to nested objects.)*
2. ✅ **Metrics/earnings** — `PostMetric` + `EarningsRecord` models, `metrics-sync` + `earnings-sync` queues/workers, approval polling via a status adapter, confirmed earnings + `PayoutStatus`.
3. ✅ **Profitability scoring** — `profitability.ts` (revenue/profit/priority + stop-conditions), surfaced on the campaign page; unit-tested.
4. ✅ **Rendering polish** — audio loudnorm, optional silence-trim, CRF compression, thumbnail generation, animated Remotion captions. *(Face-aware crop remains a center-crop — genuine face detection needs an ML model and is intentionally not faked.)*
5. ✅ **Web hardening** — `User`/`Workspace` + password auth, HMAC-signed HttpOnly session cookies, CSRF (same-origin) + rate-limit middleware, R2 pre-signed URLs. *(Rate limiting is per-instance in-memory; swap for Redis for multi-instance.)*
6. ✅ **Word-level Whisper transcription** — `WhisperTranscriber` (verbose_json word timestamps) with sandbox fallback.
7. ✅ **Screenshot/document upload** — image (Claude vision) / PDF (document block) / text upload → parse.

### Remaining honest caveats (need external services, not fakeable)
- Live campaign scraping, Claude extraction/scoring quality, real social posting, R2 storage, Whisper, and analytics all require their respective credentials/keys; without them the adapters run in sandbox mode (no fabricated data).
- Face-aware crop and per-instance→distributed rate limiting are the two intentional simplifications noted above.
- `ffmpeg` must be installed for the render/transcription pipeline to run.
