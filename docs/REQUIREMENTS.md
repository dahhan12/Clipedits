# Content Rewards Campaign Automation

## Project Purpose

Build a production-ready system that automatically discovers new Content Rewards campaigns, reads each campaign page, extracts all rules and requirements, downloads permitted source material, generates compliant short-form videos, prepares or publishes posts to supported social platforms, submits the post URL back to the campaign, and tracks approval, views, and estimated earnings.

The first release should prioritize reliability and compliance over fully unattended posting.

---

## Core Workflow

```text
Content Rewards / Whop campaign announcement
        ↓
Campaign URL discovery
        ↓
Campaign page ingestion
        ↓
Rule and resource extraction
        ↓
Structured campaign record
        ↓
Source asset download
        ↓
Transcript and clip candidate generation
        ↓
Video rendering
        ↓
Deterministic compliance validation
        ↓
Human approval
        ↓
Platform publishing or draft upload
        ↓
Campaign submission
        ↓
Approval, views, and earnings tracking
```

---

## Primary Objective

The application must automate the following process:

1. Detect new campaign announcements.
2. Extract the `contentrewards.com/discover/...` campaign URL.
3. Open the campaign page.
4. Read all visible requirements, restrictions, payout terms, supported platforms, deadlines, and linked resources.
5. Convert the campaign into validated structured data.
6. Download only approved source content.
7. Generate several high-quality short-form video drafts.
8. Validate every draft against campaign rules.
9. Place compliant drafts into an approval queue.
10. Publish automatically where supported or upload as a draft where manual completion is required.
11. Submit the public post URL to the campaign.
12. Track approval, rejection reasons, qualifying views, and estimated revenue.

---

## Product Principles

### 1. Campaign page is the source of truth

The Whop community feed should be treated as a campaign discovery source only.

The system must follow the Content Rewards campaign link and read the live campaign page before generating or publishing content.

### 2. Claude must return structured data

Claude must not return only a written summary.

Every campaign must be converted into a strict schema and validated before it enters the database.

### 3. Never invent missing rules

When a requirement is unclear, unavailable, contradictory, or low-confidence, the campaign must be marked:

```text
NEEDS_MANUAL_REVIEW
```

### 4. Deterministic checks before AI checks

Rules such as duration, dimensions, hashtags, mentions, file type, post limits, platform eligibility, and deadlines must be checked using code.

Claude should only be used for semantic requirements that cannot be evaluated deterministically.

### 5. Human approval first

The MVP should automate campaign discovery, extraction, video generation, and compliance checks, but keep a final approval step before public posting.

Fully automatic publishing can be enabled later on a platform-by-platform and campaign-by-campaign basis.

---

# Recommended Technology Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- React Query or server actions
- Video preview player
- Campaign and approval dashboards

## Backend

- Node.js
- TypeScript
- Next.js API routes or a separate Fastify service
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ

## AI

- Anthropic API
- Claude structured outputs
- Zod schema validation
- Optional Claude Agent SDK for complex ingestion workflows

## Browser Automation

- Playwright
- Persistent authenticated browser profiles
- Used only where no official API is available

## Video Processing

- FFmpeg
- Remotion
- Whisper-compatible transcription service
- Scene detection
- H.264 video
- AAC audio
- 9:16 vertical output

## Storage

- Cloudflare R2 or Amazon S3
- Signed upload and download URLs
- Checksums for deduplication

## Publishing

- TikTok publishing adapter
- Instagram Reels publishing adapter
- YouTube Shorts publishing adapter
- Draft and manual fallback modes

## Deployment

- Docker Compose for local development
- Managed PostgreSQL
- Managed Redis
- Worker containers
- Object storage
- Environment-based secrets

---

# Campaign Discovery

Implement multiple discovery adapters.

## 1. Content Rewards Discover Adapter

The adapter should:

- Open the Content Rewards discovery page.
- Extract visible campaign cards.
- Extract every campaign URL.
- Parse the campaign ID from the URL.
- Store unseen campaigns.
- Recheck existing campaigns for:
  - budget changes
  - status changes
  - updated requirements
  - updated resource links
  - campaign closure
- Calculate a content hash of the campaign page.
- Create a new campaign revision whenever the page changes.

Example campaign URL:

```text
https://contentrewards.com/discover/{campaignId}
```

## 2. Whop Community Adapter

The adapter should:

- Read recent posts from the Content Rewards community.
- Filter posts created by the campaign announcement account.
- Search post content for Content Rewards campaign links.
- Extract all unique campaign URLs.
- Save only unseen campaign IDs.
- Store the original post text and timestamp as discovery evidence.

Preferred order:

1. Official API, when access is available.
2. Authenticated Playwright session as a fallback.

Do not store raw account passwords.

## 3. Manual Campaign Entry

The dashboard must also allow the user to:

- Paste a campaign URL.
- Paste campaign text.
- Upload screenshots or documents.
- Trigger immediate parsing.

---

# Campaign Parsing

For each campaign:

1. Open the campaign page.
2. Save the raw HTML.
3. Save visible page text.
4. Extract structured fields with deterministic selectors where possible.
5. Follow linked campaign instructions and approved resource links.
6. Send the complete text to Claude.
7. Require structured output.
8. Validate output with Zod.
9. Store evidence for each extracted field.
10. Flag uncertainty and contradictions.

---

# Required Campaign Schema

```ts
type CampaignStatus =
  | "DISCOVERED"
  | "PARSING"
  | "OPEN"
  | "NEEDS_MANUAL_REVIEW"
  | "PAUSED"
  | "CLOSED"
  | "FAILED";

type Platform =
  | "TIKTOK"
  | "INSTAGRAM"
  | "YOUTUBE"
  | "X"
  | "OTHER";

interface CampaignRules {
  campaignId: string;
  title: string;
  sourceUrl: string;
  status: CampaignStatus;

  payout: {
    currency: string;
    totalBudget: number | null;
    remainingBudget: number | null;
    cpmByPlatform: Array<{
      platform: Platform;
      cpm: number;
    }>;
    minimumPayout: number | null;
    maximumPayoutPerPost: number | null;
  };

  supportedPlatforms: Platform[];

  deadlines: {
    submissionDeadline: string | null;
    campaignEndDate: string | null;
  };

  eligibility: {
    minimumFollowers: number | null;
    minimumAccountAgeDays: number | null;
    requiredCountries: string[];
    excludedCountries: string[];
    accountRequirements: string[];
  };

  videoRules: {
    minimumDurationSeconds: number | null;
    maximumDurationSeconds: number | null;
    requiredAspectRatio: string | null;
    minimumResolution: string | null;
    maximumFileSizeMb: number | null;
    requiredFormat: string | null;
    sourceContentOnly: boolean | null;
    originalEditingRequired: boolean | null;
    subtitlesRequired: boolean | null;
    subtitlesProhibited: boolean | null;
    watermarkRequired: boolean | null;
  };

  contentRules: {
    requiredAudio: string | null;
    requiredMentions: string[];
    requiredHashtags: string[];
    requiredCaptionText: string[];
    requiredOverlays: string[];
    requiredLogos: string[];
    prohibitedContent: string[];
    prohibitedWords: string[];
    prohibitedEditingTechniques: string[];
    contentThemes: string[];
  };

  postingRules: {
    maximumPostsPerAccount: number | null;
    minimumViews: number | null;
    repostsAllowed: boolean | null;
    duplicateContentAllowed: boolean | null;
    paidPromotionAllowed: boolean | null;
    postMustRemainLiveDays: number | null;
  };

  submissionRules: {
    submissionMethod: string | null;
    publicPostRequired: boolean | null;
    proofRequired: string[];
    additionalInstructions: string[];
  };

  resources: Array<{
    type:
      | "GOOGLE_DRIVE"
      | "DROPBOX"
      | "YOUTUBE"
      | "DIRECT_VIDEO"
      | "IMAGE"
      | "DOCUMENT"
      | "OTHER";
    url: string;
    purpose: string | null;
    approvedForUse: boolean;
  }>;

  unclearRules: string[];
  contradictions: string[];
  extractionConfidence: number;

  evidence: Array<{
    field: string;
    sourceText: string;
    sourceUrl: string | null;
  }>;
}
```

---

# Claude Extraction Rules

The campaign extraction prompt must instruct Claude to:

- Use only the supplied campaign content.
- Never infer a rule without evidence.
- Return `null` when information is absent.
- List ambiguous requirements inside `unclearRules`.
- List conflicts inside `contradictions`.
- Include a supporting excerpt for every populated field.
- Return a confidence score between `0` and `1`.
- Mark the campaign for manual review when confidence is below the configured threshold.
- Distinguish between required, recommended, and prohibited actions.
- Distinguish between campaign-wide and platform-specific rules.
- Never convert implied marketing language into a mandatory rule.

Suggested confidence threshold:

```text
0.90 or higher: eligible for automated processing
0.75 to 0.89: process assets but require manual rule review
Below 0.75: stop workflow
```

---

# Resource Ingestion

Support these resource types:

- Direct MP4 or MOV links
- Google Drive files and folders
- Dropbox files and folders
- Approved YouTube source URLs
- Images
- Logos
- Brand assets
- PDF instruction documents
- Caption templates

For every downloaded asset, store:

- original URL
- campaign ID
- file name
- MIME type
- file size
- checksum
- download time
- source type
- approval status
- local or object storage path

## Security Requirements

- Validate every URL.
- Block localhost and private-network destinations.
- Protect against SSRF.
- Restrict download size.
- Restrict MIME types.
- Scan file extensions.
- Reject executable files.
- Use signed storage URLs.
- Never execute downloaded content.

---

# Video Generation Pipeline

## Step 1: Transcription

For each source video:

- Extract the audio.
- Produce a word-level timestamped transcript.
- Store transcript segments.
- Detect speaker changes where possible.
- Preserve original timecodes.

## Step 2: Scene Detection

Detect:

- visual scene boundaries
- camera changes
- long silences
- abrupt audio changes
- topic changes

## Step 3: Candidate Generation

Generate clip candidates within the campaign duration limits.

A candidate should not:

- begin mid-sentence
- end mid-sentence
- begin before the hook
- include an extended dead section
- violate source restrictions
- exceed duration limits

## Step 4: Candidate Scoring

Score candidates using:

```text
candidateScore =
    hookStrength × 0.30
  + standaloneClarity × 0.20
  + emotionalIntensity × 0.20
  + campaignRelevance × 0.20
  + visualQuality × 0.10
```

Store individual component scores and Claude reasoning in an internal record.

## Step 5: Rendering

Render using FFmpeg and Remotion.

Required capabilities:

- 9:16 cropping
- face-aware positioning
- animated captions
- static captions
- safe-zone positioning
- logo overlays
- campaign text overlays
- intro hook text
- audio normalization
- silence trimming
- output compression
- thumbnail generation

Do not add any element that is not permitted by the campaign.

## Step 6: Render Manifest

Every rendered video must have a manifest containing:

- source asset IDs
- source time range
- output duration
- crop settings
- caption template
- overlays
- fonts
- audio changes
- output codec
- output resolution
- output checksum
- render timestamp

---

# Compliance Engine

The compliance engine must run before approval and again immediately before publishing.

## Deterministic Validators

Implement validators for:

- campaign status
- campaign deadline
- supported platform
- maximum post count
- video duration
- dimensions
- aspect ratio
- file format
- file size
- source asset eligibility
- required logo
- required overlay
- required mention
- required hashtag
- required caption phrase
- prohibited phrase
- prohibited source
- duplicate video
- duplicate caption
- minimum account requirements
- remaining campaign budget
- public post requirement

## Semantic Validators

Use Claude only where code cannot reliably evaluate the rule.

Examples:

- “The clip must show the artist positively.”
- “Avoid content that could damage the brand.”
- “The clip should focus on the product benefit.”
- “Do not misrepresent the speaker.”

## Compliance Result

```ts
type ComplianceStatus = "PASS" | "FAIL" | "REVIEW";

interface ComplianceResult {
  ruleId: string;
  status: ComplianceStatus;
  reason: string;
  evidence: string[];
  validatorType: "DETERMINISTIC" | "SEMANTIC";
  checkedAt: string;
}
```

Any `FAIL` must block publication.

Any `REVIEW` must require manual approval unless the user explicitly overrides it.

---

# Publishing Modes

```text
AUTO
The system can publish directly through an approved official API.

DRAFT
The system uploads the video as a draft, but the user must complete the post.

MANUAL
The system prepares the file, caption, hashtags, and instructions for manual posting.
```

Campaigns requiring any of the following should default to `DRAFT` or `MANUAL`:

- official in-app audio
- native stickers
- platform effects
- collaborator invitations
- manual product tagging
- branded content toggles
- unsupported account types
- unsupported publishing scopes

---

# Social Platform Adapters

Create a common interface:

```ts
interface PublishingProvider {
  validateAccount(accountId: string): Promise<AccountValidationResult>;

  publish(input: PublishInput): Promise<PublishResult>;

  uploadDraft(input: PublishInput): Promise<PublishResult>;

  getStatus(externalPostId: string): Promise<PublicationStatus>;

  getMetrics(externalPostId: string): Promise<PostMetrics>;
}
```

Implement adapters for:

- TikTok
- Instagram Reels
- YouTube Shorts

Store OAuth tokens encrypted.

Never expose tokens to client-side code.

Never include tokens in logs.

---

# Campaign Submission

After publication:

1. Save the public post URL.
2. Save the external platform post ID.
3. Verify that the post is publicly accessible where possible.
4. Run compliance checks again.
5. Prepare the campaign submission.
6. Submit using an official API where available.
7. Otherwise use Playwright to fill the submission form.
8. During the MVP, require confirmation before the final submission click.
9. Record submission time and confirmation.
10. Poll for approval or rejection.

Store:

- post URL
- platform
- submitted campaign
- submission status
- approval status
- rejection reason
- qualifying views
- estimated earnings
- confirmed earnings
- payout status

---

# Workflow States

```text
DISCOVERED
→ PARSING
→ PARSED
→ NEEDS_MANUAL_REVIEW
→ RESOURCES_QUEUED
→ RESOURCES_DOWNLOADED
→ TRANSCRIBING
→ CANDIDATES_GENERATED
→ RENDERING
→ COMPLIANCE_CHECKED
→ READY_FOR_APPROVAL
→ APPROVED_FOR_PUBLISHING
→ PUBLISHING
→ PUBLISHED
→ SUBMISSION_READY
→ SUBMITTED
→ CAMPAIGN_APPROVED
→ EARNING
→ PAID
```

Failure states:

```text
DISCOVERY_FAILED
PARSING_FAILED
RESOURCE_FAILED
TRANSCRIPTION_FAILED
RENDER_FAILED
COMPLIANCE_FAILED
PUBLISHING_FAILED
SUBMISSION_FAILED
```

Every job must be resumable.

---

# Database Models

Create Prisma models for:

- User
- Workspace
- Campaign
- CampaignRevision
- CampaignRule
- CampaignEvidence
- CampaignResource
- SourceAsset
- Transcript
- TranscriptSegment
- ClipCandidate
- RenderedClip
- RenderManifest
- ComplianceCheck
- SocialAccount
- Publication
- CampaignSubmission
- PostMetric
- EarningsRecord
- JobRun
- AuditEvent
- EncryptedCredential

Requirements:

- Use UUID primary keys.
- Add created and updated timestamps.
- Add unique constraints for campaign IDs and external post IDs.
- Use idempotency keys for jobs and publishing.
- Store campaign revisions rather than overwriting prior rules.
- Soft-delete records where appropriate.
- Maintain full audit history.

---

# Background Jobs

Use BullMQ queues:

```text
campaign-discovery
campaign-parsing
campaign-revision-check
resource-download
transcription
scene-detection
candidate-generation
video-render
compliance-check
publication
submission
metrics-sync
earnings-sync
cleanup
```

Each job must:

- have a unique idempotency key
- support retries
- use exponential backoff
- save error messages
- save execution duration
- save attempt count
- avoid duplicate side effects
- emit audit events

---

# Dashboard Requirements

## Main Dashboard

Show:

- newly discovered campaigns
- campaigns needing review
- campaigns ready for clip generation
- videos awaiting approval
- publishing failures
- rejected submissions
- estimated earnings
- confirmed earnings

## Campaign Card

Display:

```text
Campaign title
Campaign status
CPM
Total budget
Remaining budget
Supported platforms
Deadline
Rules confidence
Source resources
Generated clips
Compliance results
Published posts
Submission status
Estimated earnings
```

Actions:

- Open campaign
- Reparse campaign
- Compare revisions
- Download resources
- Generate clips
- Review rules
- Preview clips
- Run compliance check
- Approve
- Reject
- Upload as draft
- Publish now
- Submit post
- Retry failed job

## Rule Review Screen

Display:

- extracted field
- extracted value
- supporting evidence
- confidence
- source URL
- manual correction field

Manual edits must be saved as a separate reviewed revision.

## Clip Review Screen

Display:

- video preview
- source time range
- transcript
- candidate score
- generated caption
- hashtags
- compliance status
- render manifest

## Earnings Screen

Display:

- campaign
- platform
- qualifying views
- CPM
- estimated payout
- confirmed payout
- payment status

---

# Profitability Scoring

The system should rank campaigns before processing.

Suggested formula:

```text
estimatedRevenue =
    expectedQualifiedViews
    × effectiveCPM
    ÷ 1000

estimatedProfit =
    estimatedRevenue
    - processingCost
    - publishingCost
    - estimatedRejectionLoss
```

Campaign priority score:

```text
priorityScore =
    estimatedProfit
    × campaignConfidence
    × remainingBudgetFactor
    × timeRemainingFactor
```

Stop expensive processing when:

- the campaign is closed
- remaining budget is too low
- rules are unclear
- campaign confidence is below threshold
- account is ineligible
- expected processing cost exceeds expected profit

---

# Security and Compliance

Implement:

- encrypted OAuth token storage
- encrypted session storage
- role-based access control
- audit logs
- rate limiting
- CSRF protection
- secure cookies
- SSRF protection
- download validation
- signed object storage URLs
- secret redaction
- environment-variable validation
- database backups
- worker timeouts
- job retry limits

Do not:

- store raw social platform passwords
- expose refresh tokens
- scrape private user data
- bypass platform restrictions
- publish content without confirmed campaign permission
- download unapproved source material
- guess missing campaign rules

---

# Repository Structure

```text
campaign-clipper/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── public/
│   └── worker/
│       ├── src/
│       │   ├── jobs/
│       │   ├── queues/
│       │   ├── workers/
│       │   └── index.ts
├── packages/
│   ├── ai/
│   │   ├── campaign-parser.ts
│   │   ├── semantic-compliance.ts
│   │   └── clip-scorer.ts
│   ├── campaign-discovery/
│   │   ├── content-rewards.ts
│   │   ├── whop.ts
│   │   └── manual.ts
│   ├── compliance/
│   │   ├── validators/
│   │   └── engine.ts
│   ├── database/
│   │   ├── prisma/
│   │   └── client.ts
│   ├── publishing/
│   │   ├── tiktok.ts
│   │   ├── instagram.ts
│   │   ├── youtube.ts
│   │   └── provider.ts
│   ├── resources/
│   │   ├── downloader.ts
│   │   ├── google-drive.ts
│   │   └── dropbox.ts
│   ├── shared/
│   │   ├── schemas/
│   │   ├── types/
│   │   └── utils/
│   ├── storage/
│   │   └── r2.ts
│   └── video/
│       ├── ffmpeg.ts
│       ├── remotion/
│       ├── transcription.ts
│       ├── scene-detection.ts
│       └── candidate-generator.ts
├── docker/
├── scripts/
├── tests/
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# Environment Variables

```env
DATABASE_URL=
REDIS_URL=

ANTHROPIC_API_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=

WHOP_API_KEY=
WHOP_EXPERIENCE_ID=

TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=

META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=

YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=

ENCRYPTION_KEY=
SESSION_SECRET=
APP_URL=

PLAYWRIGHT_STORAGE_STATE_PATH=
```

Validate every required variable at startup.

---

# MVP Delivery Plan

## Phase 1 — Campaign Discovery and Parsing

Build:

- database
- campaign discovery
- manual campaign URL entry
- campaign page parser
- Claude structured extraction
- rule evidence
- campaign dashboard
- campaign revision tracking

Success condition:

A new campaign appears in the dashboard with correctly extracted rules and evidence.

## Phase 2 — Resource Download and Clip Candidates

Build:

- resource adapters
- secure downloader
- transcription
- scene detection
- candidate extraction
- candidate scoring
- candidate review UI

Success condition:

The system downloads permitted footage and produces ranked clip ranges.

## Phase 3 — Rendering and Compliance

Build:

- Remotion templates
- FFmpeg rendering
- caption renderer
- deterministic validators
- semantic validators
- compliance dashboard
- video preview

Success condition:

The system creates several campaign-compliant video drafts and blocks invalid outputs.

## Phase 4 — Publishing

Build:

- encrypted OAuth storage
- TikTok adapter
- Instagram adapter
- YouTube adapter
- AUTO, DRAFT, and MANUAL modes
- approval queue

Success condition:

An approved clip can be published or uploaded as a draft without exposing credentials.

## Phase 5 — Submission and Tracking

Build:

- campaign submission workflow
- Playwright submission fallback
- post verification
- metric polling
- approval and rejection tracking
- earnings dashboard

Success condition:

The system submits a published post and tracks its campaign result.

---

# Initial Build Instructions for Claude Code

```text
You are building a production-ready TypeScript application called CampaignClipper.

Read this entire project specification before changing any code.

Start with Phase 1 only.

Your first tasks are:

1. Create the monorepo structure.
2. Configure pnpm workspaces.
3. Create a Next.js application.
4. Create a Node.js worker application.
5. Configure PostgreSQL, Prisma, Redis, and BullMQ.
6. Create the complete Prisma schema.
7. Create the Zod CampaignRules schema.
8. Create a campaign discovery adapter interface.
9. Implement the manual campaign URL adapter.
10. Implement the Content Rewards browser discovery adapter.
11. Implement campaign page capture using Playwright.
12. Implement Claude structured rule extraction.
13. Store campaign evidence and revisions.
14. Build the campaign list screen.
15. Build the campaign detail and rule review screen.
16. Add Docker Compose.
17. Add an .env.example file.
18. Add unit tests for campaign URL parsing and schema validation.
19. Add integration tests for idempotent campaign ingestion.
20. Run linting, type checking, and tests.

Engineering requirements:

- Use strict TypeScript.
- Do not use `any`.
- Use small, testable modules.
- Use Zod at every external boundary.
- Use Prisma transactions where consistency matters.
- Add structured logging.
- Add idempotency keys.
- Add full error handling.
- Never silently ignore errors.
- Never fabricate campaign rules.
- Save source evidence for every extracted field.
- Stop automatic processing when campaign confidence is too low.
- Do not implement fake social publishing.
- Do not hardcode secrets.
- Do not expose credentials to the browser.
- Do not move to the next phase until Phase 1 tests pass.

Before coding, output:

1. proposed architecture
2. dependency list
3. repository tree
4. Prisma model plan
5. queue design
6. parsing strategy
7. security risks
8. implementation order

Then begin implementation.
```

---

# Definition of Done for the MVP

The MVP is complete when:

- New campaigns are discovered automatically.
- Campaign rules are stored in structured form.
- Every extracted rule has supporting evidence.
- Unclear campaigns are blocked for review.
- Approved source files can be downloaded safely.
- Videos can be transcribed.
- Clip candidates can be generated and ranked.
- Vertical videos can be rendered.
- Campaign compliance can be checked.
- Videos can be reviewed in the dashboard.
- Approved videos can be uploaded as drafts or published through supported integrations.
- Published URLs can be prepared for campaign submission.
- Campaign results and estimated earnings are visible.
- Duplicate jobs do not cause duplicate posts.
- Secrets remain encrypted and server-side.
- Failed jobs can be retried safely.

---

# Final Product Vision

The finished product should operate as an intelligent campaign execution engine.

The user should be able to open one dashboard and see:

```text
New campaign detected
Rules extracted
Source footage downloaded
Six clips generated
Five clips passed compliance
One clip requires review
Three platforms available
Estimated return calculated
Ready for approval
```

The system should reduce the manual workflow from repeatedly reading campaign pages, downloading assets, editing clips, checking rules, posting, and submitting links into a controlled approval workflow with clear evidence, compliance protection, and revenue tracking.
