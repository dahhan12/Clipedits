# CampaignClipper

Discover new **Content Rewards** campaigns, extract every requirement into
validated structured data, download permitted resources, generate compliant
short-form video drafts, publish/prepare them, and track post URLs and
campaign submissions.

> **Status: Phases 1–2** — campaign discovery, parsing, database, dashboard
> (Phase 1) plus resource ingestion, transcription and clip-candidate
> generation (Phase 2) are implemented. Interfaces and DB persistence for
> Phases 3–5 (rendering, compliance, publishing, submission) are scaffolded so
> later phases drop in without re-architecting. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

## Testing

`npm run typecheck && npm run lint && npm run test` — run after every major
stage. CI-equivalent commands all pass on this branch.
