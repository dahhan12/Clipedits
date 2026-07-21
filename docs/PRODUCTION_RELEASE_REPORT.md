# CampaignClipper — Production Release Report

**Scope of this report:** the production-hardening pass. It covers the **P0**
(launch-critical) work and the **P1** (reliability/observability/operability)
work — both complete and tested — and states plainly what remains (P1-9
advanced tracing, P2) and whether the system can honestly be called
production-ready.

**Honest verdict up front:** **Not yet production-ready for live public
posting.** The P0 data-integrity, security, rights, isolation, capability-gating,
media-safety and rate-limiting work is done and tested, and the P1 AI-evaluation
harness, observability/graceful-shutdown, encryption rotation, expanded CI, and
staging-mode guard have landed. But (a) **no external network integration is
`LIVE_VERIFIED`** — see `PRODUCTION_READINESS_AUDIT.md` — and (b) provider
approvals (TikTok/IG/YouTube) remain outstanding. It is suitable for an
**internal/staging pilot** that prepares drafts and never auto-posts publicly.

---

## 1. What was implemented (P0 — all complete, all tested)

| # | Block | Key changes | Verification |
| - | ----- | ----------- | ------------ |
| P0-1 | Reality audit | `PRODUCTION_READINESS_AUDIT.md`; `/providers` dashboard; `providerReadiness` registry | Manual; statuses conservative by construction |
| P0-2 | Idempotency & state | State machines for 6 entities; `guardedTransition` (optimistic concurrency); unique keys on ClipCandidate/RenderedClip/PostMetric; publish re-checks compliance FAIL in a txn | Unit (state machines) + integration (stale write, invalid transition, idempotent revision, publish-after-FAIL, submission-once, dup-publication) |
| P0-3 | Rights & provenance | `AssetPermission`/`RuleEvidence`/`PlatformPolicySnapshot`; provisional permission on download; render gate; `sourcePermission` compliance check (unknown → REVIEW, never PASS); operator verify | Unit + integration (provisional=REVIEW, verified=PASS, denied=FAIL+render blocked, none=REVIEW) |
| P0-4 | Multi-tenant isolation | `Campaign.workspaceId`; centralised `workspaceScope`; signed-URL + mutation + list-page scoping | Integration (cross-workspace denied; owner allowed; shared pool visible; visibility filter) |
| P0-5 | Capability gating | `computeCapabilities`; publish downgrades AUTO→DRAFT when the platform/app can't publish publicly; UI disables & explains "Publish now" | Unit (gating matrix incl. unaudited/unverified/in-app-audio) |
| P0-6 | Media hardening | ffmpeg `shell:false` + hard timeout/kill; `validateMedia` probe-gate (corrupt/dimension/duration/stream caps); temp-dir cleanup; `assertSafeKey` path-traversal guard | Integration (corrupt reject, caps, missing-audio allowed, traversal keys) + real render smoke |
| P0-7 | Distributed rate limiting | Redis atomic limiter; enforced on login/publish/submit/reparse/download/clipGen/campaignCreate | Integration (limit+block+retry-after; per-key isolation) |

**Test totals:** 86 unit tests + 31 integration tests (real Postgres + Redis +
ffmpeg; integration suites self-skip without those services). `typecheck`,
`lint`, and the production `build` pass. A real end-to-end render produces a
genuine 1080×1920 H.264/AAC MP4 + thumbnail with 21+ compliance checks executing,
including the `sourcePermission=REVIEW` gate. (Unit total includes the P1-8 eval,
P1-10 envelope, and P1-9 failure-classifier suites.)

## 2. Migrations added

`idempotency_state_versions`, `rights_provenance`, `metrics_and_earnings`
(earlier), `multitenant_workspace`, `dead_letter_and_provider_stats` (P1-9
advanced: `DEAD_LETTER` job status, `JobRun.failureCategory`/`deadLetteredAt`/
`updatedAt`, `ProviderStat` table), `prepublication_review` (P2-15:
`PrePublicationReview` table + `ReviewDecision` enum), plus the pre-existing
phase migrations. All
are recorded in `prisma/migrations`; `prisma migrate status` reports the DB in
sync. Apply in production with `prisma migrate deploy`.

## 3. Live integrations actually verified

**None over the network.** Verified end-to-end **locally**: PostgreSQL, Redis/
BullMQ, the local object store, and the FFmpeg render + deterministic compliance
path. Everything third-party is `IMPLEMENTED_NOT_VERIFIED`, `SANDBOX_VERIFIED`,
`FALLBACK_ONLY`, or `BLOCKED_BY_PLATFORM_APPROVAL` (see the audit).

## 4. Credentials / approvals still required before public launch

- **Anthropic** API key (extraction/scoring/vision) — and an accuracy evaluation (P1-8).
- **Whisper** endpoint/key for real transcription.
- **Cloudflare R2** credentials (currently local store).
- **TikTok** Content Posting **audit** (public/direct posting blocked until then).
- **Instagram** content-publishing **app review** + Business/Creator account + public video hosting.
- **YouTube** API project **verification** (else private uploads only).
- **Whop** API key + experience id (or a validated Playwright session).

## 5. P1 status (landed & tested) and remaining work

**Done (P1):**

| # | Block | Key changes | Verification |
| - | ----- | ----------- | ------------ |
| P1-8 | AI evaluation harness | `src/eval/*` (fields, scoring, 26 fixtures, runner); `npm run eval`; metrics incl. headline **falsePassRate**, criticalFieldAccuracy, contradictionRecall, hallucinationCount, manualReviewRate; thresholds gate; `docs/AI_EVALUATION.md` | Unit (`tests/eval.test.ts`) on fixtures; live eval self-runs against Anthropic when key present, fails only on LIVE miss |
| P1-9 (core) | Observability & recovery | `registerGracefulShutdown` (SIGTERM/SIGINT drains active jobs via `worker.close()`) wired into all 5 workers; `metrics.ts` (queue depths, job-run stats, pipeline funnel); `/observability` dashboard; per-job `correlationId` + child logger + `durationMs` in `withJobRun` | Manual dashboard; shutdown wired in every worker entrypoint |
| P1-9 (advanced) | Dead-letter & provider metrics | `failureCategory.ts` classifier (8 buckets + retryable flag); `handleTerminalFailure` parks exhausted jobs as `DEAD_LETTER` with a category; `replayService` safe replay (non-retryable requires audited force override) + `/api/jobs/replay` (RBAC `job.retry`, CSRF) + dashboard replay UI; `ProviderStat` per-provider latency/error metrics wrapping Anthropic/Whisper/TikTok/IG/YouTube calls, surfaced on `/observability` | Unit (`failureCategory.test.ts`, 9) + integration (`deadLetter.itest.ts`: capture, gating, retryable/force replay, not-found) |
| P1-10 | Encryption key rotation | Versioned envelope format `cc1:<keyId>:…` with keyId bound as GCM AAD; `KeyProvider`/`EnvKeyProvider`; `needsRewrap`; legacy fallback; `scripts/rotate-secrets.ts`; `docs/SECRET_ROTATION.md` | Unit (`tests/envelope.test.ts`: roundtrip, versioned decrypt, AAD-tamper reject, legacy decrypt, rewrap detection) |
| P1-11 | Expanded CI | `.github/workflows/ci.yml`: containerised Postgres 16 + Redis 7 + ffmpeg; prisma generate + `migrate deploy`; lint, typecheck, unit, integration, build, eval; `npm audit` high-severity gate (prod deps) | Runs the full check suite from a clean checkout |
| P1-12 | Staging mode | `deployEnv.ts` (`checkDeployment` pure fn, `validateDeploymentEnv`, `appEnv`, `publicPostingAllowedByEnv`, `isProdLikeEnv`); blocks prod approvals in local/CI; requires secrets in staging/prod; called at startup (`instrumentation.ts`) and in every worker; capability gating forces DRAFT off-prod | Unit (deploy-env matrix); enforced at startup |

**Remaining work:**

- **P1-9 (advanced, partial)** — the dead-letter/terminal-failure workflow and
  per-provider API metrics are **done** (see the table above). Still outstanding:
  **OpenTelemetry distributed tracing** — deferred deliberately because it needs
  a collector endpoint (an infra decision), and correlation-id log tracing
  already threads a single job across stages; wire OTel once a backend
  (Tempo/Honeycomb/etc.) is chosen.
- **P2-13 (done)** — perceptual/audio near-duplicate detection: `perceptualHash.ts`
  computes a dHash over sampled frames + a median-thresholded audio envelope
  fingerprint; `renderService` persists both to `RenderedClip`; `complianceService`
  FAILs a clip that is within threshold of an already-published clip in the same
  campaign (`checkPerceptualDuplicate`). Unit-tested (`perceptualHash.test.ts`) +
  real-ffmpeg integration test (re-encode matches, distinct clip separates).
- **P2-15 (done)** — operator pre-publication review + override audit trail:
  `PrePublicationReview` model records an APPROVED/REJECTED verdict, the
  justification, and exactly which REVIEW checks were acknowledged;
  `prePublicationService` enforces that a FAIL and safety-critical REVIEWs
  (rights/provenance, prohibited content, duplicates) are **never** waivable;
  an approved override lets `publishClip` proceed at AUTO despite waivable
  REVIEWs. Route `/api/clips/[id]/review` (RBAC `publish.now`, CSRF) + an
  operator panel on the clip page. Unit (`prePublicationReview.test.ts`) +
  integration (`prePublicationReview.itest.ts`).
- **P2-14, P2-16** — cost/capacity controls & kill switches, disaster-recovery
  validation & runbooks.
- **P0 follow-ups:** queue payloads don't yet carry workspaceId for worker
  re-verification (mitigated: enqueue routes are ownership-checked); rate limiting
  has a coarse per-instance edge layer in addition to the authoritative Redis one.

## 6. Deployment steps

1. Provision managed Postgres + Redis + R2; set all env vars (`.env.example`);
   generate `ENCRYPTION_KEY` and `SESSION_SECRET`.
2. `npm ci && npx prisma migrate deploy && npm run build`.
3. `npm run seed:admin` (sets the first ADMIN; store the printed password).
4. Start the web app and the workers (`worker:discovery`, `worker:pipeline`,
   `worker:render`, `worker:publish`, `worker:submission`). ffmpeg must be installed.
5. Leave all `*_AUDITED/_APPROVED/_VERIFIED` flags **false** until provider review
   passes — the app will correctly refuse public posting.

## 7. Rollback steps

- App: redeploy the previous image/tag.
- DB: migrations here are additive (new nullable columns / tables / indexes), so
  rolling the app back is safe without a down-migration. If a down-migration is
  required, restore from the pre-deploy Postgres backup (see DR — pending P2-16).

## 8. Monitoring checklist

Instrumented now: queue depths, job-run success/failure/duration stats, the
pipeline funnel, a **dead-letter table** (with failure category + replay), and
**per-provider API latency/error-rate** are all surfaced on `/observability`;
every job logs a `correlationId` and `durationMs`. Still a target: distributed
tracing spans (OTel — deferred pending a collector choice). Remaining business
signals to wire dashboards for: parse confidence & manual-review rate · render
duration/cost · publication/submission status · estimated vs confirmed earnings.

## 9. Security checklist

- [x] SSRF guard, download host allowlist, size/type caps, media probe-gate
- [x] AES-256-GCM secret encryption; log redaction; secrets in env only
- [x] RBAC; signed HttpOnly session cookies; CSRF (same-origin) + Redis rate limits
- [x] Multi-tenant isolation on signed URLs, mutations, and reads
- [x] Rights/provenance gate (no unauthorised media use; unknown → REVIEW)
- [x] Optimistic concurrency + state machines (no dup publish / stale overwrite)
- [x] Encryption key rotation (P1-10, versioned envelope + rotation script)
- [x] Dependency vuln scan gate (P1-11, `npm audit` high-severity gate in CI)
- [ ] Pen-test / external security review

## 10. Launch blockers (must clear before public, auto-posting launch)

1. No integration is `LIVE_VERIFIED` — verify each against the real provider.
2. TikTok/IG/YouTube provider approvals outstanding.
3. AI extraction/compliance accuracy must be run against the **live** model and
   meet thresholds — the harness exists (P1-8) but LIVE eval needs the API key
   and a passing run recorded here.
4. Disaster-recovery validation and runbooks outstanding (P2-16); distributed
   tracing (OTel) outstanding (P1-9 advanced) — dead-letter replay and
   per-provider metrics are done.

**Cleared for:** internal/staging pilot in **draft/manual** mode (no public AUTO
posting), which the capability gating enforces by default.

_Update this report as P1/P2 land; do not upgrade the verdict while any launch
blocker above remains._
