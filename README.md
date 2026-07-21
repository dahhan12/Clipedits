# CampaignClipper

Discover new **Content Rewards** campaigns, extract every requirement into
validated structured data, download permitted resources, generate compliant
short-form video drafts, publish/prepare them, and track post URLs and
campaign submissions.

> **Status: Phases 1–5 (complete)** — discovery, parsing, database, dashboard
> (1); resource ingestion, transcription, clip candidates (2); 9:16 rendering
> (FFmpeg + Remotion) and the deterministic compliance engine (3); OAuth + draft
> publishing to TikTok / Instagram Reels / YouTube Shorts (4); campaign
> submission and performance tracking (5). External integrations use adapters
> with sandbox modes; their interfaces and DB persistence are complete. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), the full
> [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md), and the
> [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) (implemented vs. remaining).

## Stack

Next.js (App Router) · TypeScript · PostgreSQL + Prisma · Redis + BullMQ ·
Playwright · Anthropic SDK · Zod · FFmpeg + Remotion (Phase 3) · Cloudflare R2 ·
Docker Compose.

## Quick start

```bash
cp .env.example .env            # fill in secrets; generate ENCRYPTION_KEY:
                                # openssl rand -base64 32
docker compose up -d postgres redis minio
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev                     # dashboard at http://localhost:3000
npm run worker:discovery        # discovery + parse workers (separate terminal)
npm run worker:pipeline         # ingest + transcribe + clip workers (Phase 2)
```

FFmpeg is required for real transcription/scene-detection; when it (or a live
ASR backend) is absent, the pipeline falls back to deterministic sandbox
transcripts and heuristic scene windows so it still runs end to end.

Without an `ANTHROPIC_API_KEY` / `WHOP_API_KEY`, the corresponding adapters run
in **sandbox mode** — real interfaces and DB persistence, safe fallbacks for the
external call.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dashboard |
| `npm run worker:discovery` | Discovery + parse BullMQ workers |
| `npm run worker:pipeline` | Ingest + transcribe + clip BullMQ workers |
| `npm run worker:render` | Render + compliance BullMQ workers (needs ffmpeg) |
| `npm run worker:publish` | Publish BullMQ worker (TikTok/IG/YouTube) |
| `npm run worker:submission` | Submission + tracking BullMQ workers |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run prisma:migrate` | Apply Prisma migrations |

## What's implemented (Phase 1)

- **Discovery adapters** — `ContentRewardsDiscoverAdapter` (Discover page →
  campaign cards → `/discover/:id` → page-hash revision detection) and
  `WhopForumAdapter` (official Whop Forums API with a Playwright fallback,
  filtering `contentrewardsbot` posts for `contentrewards.com/discover` links).
- **Campaign parser** — opens the campaign page, follows visible resource/rule
  links, and extracts a **Zod-validated** `CampaignRules` object via Claude
  structured output. Evidence per field, confidence score, and
  `NEEDS_MANUAL_REVIEW` on low confidence / contradictions. No unvalidated model
  output ever reaches the database.
- **Idempotent persistence** — upserts keyed so retries never double-process a
  campaign (`JobRun` guard on `(queue, jobKey)`, revisions on
  `(campaignId, pageHash)`).
- **Dashboard** — overview, new campaigns, campaign rules detail (with reparse),
  jobs/errors, plus scaffolded pages for later phases.
- **Security** — SSRF-guarded URL validation, download host allowlist + size
  caps, AES-256-GCM secret encryption, log redaction, RBAC, audit log.

## What's implemented (Phase 2)

- **Resource ingestion** — resolves Google Drive / Dropbox share links to
  direct downloads, streams **permitted** resources into R2 (local sandbox
  fallback) with SSRF guard, content-type allowlist, max-size cap and a rolling
  SHA-256 checksum; persists `SourceAsset` idempotently on
  `(campaignId, checksum)`, preserving original source and download timestamp.
  Unapproved sources are never downloaded; folders and YouTube are flagged as
  needing a provider API / extractor rather than faked.
- **Transcription** — ffprobe duration + a pluggable `Transcriber` (sandbox
  backend included) producing a Zod-validated timestamped transcript.
- **Clip candidates** — ffmpeg scene detection → duration-constrained,
  scene-aligned candidate ranges → Claude scoring (hook / clarity / emotional
  intensity / campaign relevance / standalone value, re-validated with Zod) →
  rejection of duration/source violations and below-bar clips → persisted
  `ClipCandidate`s.
- **Dashboard** — real Source assets and Clip candidates pages, plus
  "Download resources" and "Generate clips" actions (RBAC-gated).

## What's implemented (Phase 3)

- **Rendering** — approving a candidate renders a **9:16 H.264/AAC MP4** with
  FFmpeg (trim → scale/crop → encode). Captions / logos / mentions / overlays
  are applied **only when the campaign requires or permits them**. A real
  Remotion composition (`src/remotion/`) is available as an overlay-compositing
  backend (`RENDER_BACKEND=remotion`) with automatic FFmpeg fallback. Every
  transformation and overlay is recorded in a Zod-validated **render manifest**.
- **Platform captions** — per-platform caption text; a Claude-written hook line
  with mandatory mentions/hashtags/required phrases appended **deterministically**
  so required elements can never be dropped.
- **Compliance engine** — 15 deterministic validators (duration, dimensions,
  aspect ratio, file format, source eligibility, mandatory overlays / text /
  mentions / hashtags, platform eligibility, deadline, max posts, duplicate
  content, campaign status, remaining budget) plus a Claude **semantic**
  prohibited-content check. Every check yields `PASS | FAIL | REVIEW` + reason;
  unknowns are REVIEW, never a false PASS.
- **Dashboard** — Approval queue (Approve / Reject / Regenerate), Compliance
  results, and a Clip preview page with inline 9:16 video, manifest, captions
  and per-check results.

## What's implemented (Phase 4)

- **Publishing providers** — TikTok (Content Posting API), Instagram Reels
  (Graph API) and YouTube Shorts (Data API resumable upload). Official APIs are
  used when the account is connected; otherwise a **local DRAFT is prepared** —
  never browser-automated posting, never a faked post.
- **OAuth** — refresh tokens stored **AES-256-GCM encrypted**; access tokens
  fetched at publish time and never logged.
- **Modes & safety** — `AUTO / DRAFT / MANUAL`. Publishing is **blocked on any
  compliance FAIL**; AUTO is **downgraded to DRAFT** when compliance has REVIEWs
  or the clip requires official in-app audio/stickers/effects. Idempotent on
  `(clip, platform, mode)`.
- **Dashboard** — publish controls on the clip preview and a Publications page.

## What's implemented (Phase 5)

- **Submission** — records the post URL + external id, verifies public
  accessibility where possible, and prepares a `CampaignSubmission`
  (idempotent). With no official submission API, a **Playwright form-fill**
  adapter submits — gated behind an explicit **human confirmation** before the
  final MVP submit.
- **Tracking** — qualified views from platform analytics (null when no analytics
  token — never fabricated) and **estimated earnings** derived deterministically
  from campaign CPM, clamped to min/max payout.
- **Dashboard** — Submissions (with Confirm & submit), Earnings estimates, and a
  **Retry failed job** action on the jobs page.

## Testing

`npm run typecheck && npm run lint && npm run test` — run after every major
stage. CI-equivalent commands all pass on this branch.
