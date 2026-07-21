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
| **Manual campaign entry** (paste URL/text, upload screenshots/docs) | ⬜ | Not built — needs a form + `manual` adapter + parse-from-text path |

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
| **Rule review screen with manual correction → new revision** | ⬜ | Rules are read-only in UI today |
| **Compare revisions** action | ⬜ | Revisions stored; no diff UI |
| Tailwind CSS | ⬜ | Hand-rolled CSS (`globals.css`) instead of Tailwind |
| Profitability / priority scoring | ⬜ | Not built |
| Security: SSRF, encryption, redaction, RBAC, audit, env validation, worker timeouts | ✅ | |
| Security: **CSRF, rate limiting, secure cookies, signed storage URLs, session encryption, DB backups** | ⬜ | Not yet |
| Tests: unit (URL/schema/ranges/compliance/earnings) | ✅ | 37 tests |
| Tests: **integration test for idempotent ingestion** | ⬜ | |
| Repo layout: **pnpm monorepo (apps/web + apps/worker + packages/*)** | 🟡 | Single Next app with `src/` modules + `tsx` workers (functionally equivalent) |

## Suggested next steps to reach full spec parity

1. **Manual campaign entry** (paste URL/text/upload) — highest user-facing value.
2. **Rule review UI** with manual corrections saved as a new reviewed revision, plus **revision compare**.
3. **Schema enrichment** to the nested shape + missing fields; add the three-band confidence thresholds.
4. **Metrics/earnings**: `metrics-sync` + `earnings-sync` queues, `PostMetric`/`EarningsRecord` models, approval polling, confirmed earnings & payout status.
5. **Rendering polish**: audio normalization, silence trim, thumbnails, animated captions (Remotion), face-aware crop.
6. **Profitability scoring** to prioritise campaigns before expensive processing.
7. **Web hardening**: CSRF, rate limiting, secure cookies, R2 pre-signed URLs, `User`/`Workspace` + real auth.
8. **Word-level Whisper transcription** adapter.
