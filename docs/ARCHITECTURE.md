# CampaignClipper — Architecture

CampaignClipper discovers new **Content Rewards** campaigns, extracts every
campaign requirement into validated structured data, downloads permitted
resources, generates compliant short-form video drafts, prepares/publishes
them, and tracks the resulting post URLs and campaign submissions.

This document describes the system as designed across all five delivery
phases. The repository currently implements **Phase 1** (discovery, parsing,
database, dashboard) with complete interfaces and DB persistence for later
phases so nothing has to be re-architected as they land.

---

## 1. Guiding principles

1. **No mocked core workflow.** External integrations are wrapped in
   *adapters* with sandbox modes, but their interfaces and their database
   persistence are complete and real.
2. **Nothing untrusted enters the database.** All model output is forced
   through Zod validation. Free-form LLM text is never persisted as
   structured data.
3. **Idempotency everywhere.** Every unit of work is keyed so a retried job
   never double-processes a campaign or a post. Discovery, parsing, rendering,
   publishing and submission all use deterministic upsert keys.
4. **Deterministic compliance first, LLM last.** Rules that can be checked
   mechanically (duration, dimensions, format, deadline, budget, post count…)
   are checked by pure functions. Claude is used only for genuinely semantic
   rules.
5. **Security by default.** All external URLs are validated and SSRF-guarded,
   downloads are type/size restricted, OAuth tokens are encrypted at rest,
   secrets are redacted from logs, and every state change is audited.

---

## 2. High-level component map

```
                    ┌─────────────────────────────────────────────┐
                    │                Next.js app                   │
                    │  (App Router: dashboard pages + API routes)  │
                    └───────────────┬─────────────────────────────┘
                                    │ enqueue / read
                                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                       BullMQ queues (Redis)                     │
        │  discovery · parse · ingest · transcribe · clip · render ·      │
        │  compliance · publish · submit · track                          │
        └───────────────┬───────────────────────────────────────────────┘
                        │ processed by
                        ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                          Workers                                │
        │  DiscoveryWorker → ParseWorker → IngestWorker → PipelineWorkers │
        └───────┬───────────────┬───────────────┬───────────────────────┘
                │               │               │
     ┌──────────▼───┐  ┌────────▼────────┐  ┌───▼──────────────┐
     │  Discovery   │  │  Campaign parse │  │  Video pipeline  │
     │  adapters    │  │  (Claude +Zod)  │  │ (FFmpeg/Remotion)│
     └──────┬───────┘  └────────┬────────┘  └───┬──────────────┘
            │                   │               │
            ▼                   ▼               ▼
      Playwright /        Anthropic SDK    Publish adapters
      Whop API                             (TikTok/IG/YT)
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │       PostgreSQL (Prisma)   +   R2 object storage              │
        └───────────────────────────────────────────────────────────────┘
```

---

## 3. Tech stack

| Concern            | Choice                                             |
| ------------------ | -------------------------------------------------- |
| App & dashboard    | Next.js (App Router) + TypeScript + React          |
| Persistence        | PostgreSQL via Prisma ORM                           |
| Queues / jobs      | Redis + BullMQ                                      |
| Browser automation | Playwright (persistent authenticated context)      |
| LLM extraction     | Anthropic TypeScript SDK (structured tool output)  |
| Validation         | Zod (single source of truth for shapes)            |
| Video              | FFmpeg + Remotion (Phase 3)                         |
| Object storage     | Cloudflare R2 (S3-compatible via AWS SDK)          |
| Local dev          | Docker Compose (Postgres + Redis)                  |

---

## 4. Data model (Prisma)

See `prisma/schema.prisma`. Core entities:

- **Campaign** — one discovered campaign, keyed by `(source, externalId)`.
- **CampaignRevision** — an immutable snapshot + page hash; new revision only
  when the page hash changes (budget/status/requirement drift detection).
- **CampaignRule** — the validated `CampaignRules` payload (JSON) plus a
  denormalized status (`PARSED` / `NEEDS_MANUAL_REVIEW`) and confidence.
- **CampaignResource** — a permitted resource link (drive/dropbox/direct/yt).
- **SourceAsset** — a downloaded source video: original source, checksum,
  campaign association, download timestamp.
- **ClipCandidate** — a candidate clip range with Claude scores.
- **RenderedClip** — a produced 9:16 MP4 + render manifest.
- **ComplianceResult** — PASS/FAIL/REVIEW + reason per rule per clip.
- **SocialAccount** — a connected platform account; encrypted OAuth tokens.
- **Publication** — a publish attempt (AUTO/DRAFT/MANUAL) + post URL/id.
- **CampaignSubmission** — the campaign submission + approval/earnings.
- **JobRun** — one queue job execution (idempotency + observability).
- **AuditEvent** — append-only log of every meaningful state change.

**Idempotency keys**

| Entity              | Unique key                                   |
| ------------------- | -------------------------------------------- |
| Campaign            | `(source, externalId)`                       |
| CampaignRevision    | `(campaignId, pageHash)`                     |
| SourceAsset         | `(campaignId, checksum)`                      |
| Publication         | `(clipId, platform, idempotencyKey)`         |
| CampaignSubmission  | `(campaignId, publicationId)`                |
| JobRun              | `(queue, jobKey)`                            |

---

## 5. Campaign discovery

Two adapters implement a common `DiscoveryAdapter` interface returning
`DiscoveredCampaign[]`:

### ContentRewardsDiscoverAdapter
- Loads the Content Rewards **Discover** page with Playwright.
- Extracts campaign cards and `/discover/:campaignId` URLs.
- Parses the campaign id out of each URL.
- Computes a stable **page hash** per campaign to detect revisions
  (budget / status / requirement changes).

### WhopForumAdapter
- **Primary:** the official Whop Forums API when `WHOP_API_KEY` and
  `WHOP_EXPERIENCE_ID` are supplied — fetch recent forum posts, filter to
  those authored by `contentrewardsbot`, extract every
  `contentrewards.com/discover` link.
- **Fallback:** a Playwright persistent authenticated session that scrapes
  the same forum. Raw Whop passwords are **never** stored — only the
  persistent browser context on disk (git-ignored) and API keys in env.

The **DiscoveryWorker** runs both adapters, upserts campaigns idempotently,
writes a `CampaignRevision` only when the page hash changed, records a
`JobRun` and `AuditEvent`, and enqueues a `parse` job for new/changed
campaigns.

---

## 6. Campaign parsing

The **CampaignParser** opens each campaign page (and follows its visible
resource and campaign-rule links), then asks Claude — via a strict tool
schema mirroring the Zod `CampaignRules` shape — to extract the rules.

- Output is validated with `CampaignRulesSchema`. **Unvalidated free-form
  model output never reaches the database.**
- Every extracted field carries an **evidence excerpt**; the payload carries
  a **confidence score** and a list of **uncertain/contradictory**
  requirements.
- If requirements are unclear/contradictory or confidence is low, the
  campaign is marked **NEEDS_MANUAL_REVIEW**. Missing rules are never
  invented — absent fields stay absent.

---

## 7. Resource ingestion (Phase 2)

Supported sources: direct video URLs, Google Drive folders/files, Dropbox
folders/files, and YouTube URLs **only when the campaign expressly permits
them**. Each `SourceAsset` preserves original source, checksum, campaign
association and download timestamp. Downloads from unapproved sources are
refused by the security layer (host allowlist + SSRF guard + type/size caps).

## 8. Video pipeline (Phases 2–3)

Per source video: transcript → scene detection → candidate ranges → Claude
scoring (hook / clarity / emotional intensity / campaign relevance /
standalone value) → reject on duration/source violations → render 9:16 with
FFmpeg + Remotion → captions/logos/mentions/overlays *only when permitted or
required* → H.264/AAC MP4 → persist a **render manifest** of every transform.

## 9. Compliance engine (Phase 3)

Deterministic validators for duration, dimensions, aspect ratio, format,
source eligibility, mandatory overlays/text/mentions/hashtags, platform
eligibility, deadline, max posts, duplicate content, campaign status and
remaining budget. Claude is used only for semantic rules. Every result is
`PASS | FAIL | REVIEW` with a reason.

## 10. Publishing (Phase 4)

Provider adapters for TikTok, Instagram Reels and YouTube Shorts with
`AUTO | DRAFT | MANUAL` modes. Official APIs are used instead of browser
automation. OAuth refresh tokens are encrypted at rest. Campaigns requiring
official in-app audio/stickers/effects default to `DRAFT`/`MANUAL`.

## 11. Submission & tracking (Phase 5)

Record post URL + external id, verify public accessibility where possible,
prepare/execute the campaign submission (API when available, else a
Playwright form fill that requires human confirmation before the final MVP
submit), and track approval, rejection reason, qualified views and estimated
earnings.

---

## 12. Security

- **URL validation + SSRF guard** (`src/lib/security/url.ts`): rejects
  non-http(s), credentialed, non-public / private / loopback / link-local /
  metadata addresses, and hosts outside the allowlist for downloads.
- **Download limits:** file-type and max-size restrictions.
- **Encryption at rest** (`src/lib/security/crypto.ts`): AES-256-GCM for
  OAuth refresh tokens using `ENCRYPTION_KEY`.
- **Log redaction** (`src/lib/logging/logger.ts`): secrets never logged.
- **RBAC:** roles (`ADMIN`, `OPERATOR`, `VIEWER`) gate dashboard actions.
- **Audit:** `AuditEvent` records every meaningful state change.
- **Secrets in env** only; `.env` is git-ignored, `.env.example` documents
  every key.

---

## 13. Delivery phases

1. **Phase 1 (this repo):** discovery, parsing, database, dashboard.
2. **Phase 2:** resource downloading, transcription, clip candidates.
3. **Phase 3:** rendering + deterministic compliance.
4. **Phase 4:** OAuth + draft publishing.
5. **Phase 5:** submission + performance tracking.

Type checking, linting and tests are run after every major stage.
