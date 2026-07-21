# CampaignClipper — Production Release Report

**Scope of this report:** the production-hardening pass. It covers the **P0**
(launch-critical) work, which is complete and tested, and states plainly what
remains (P1/P2) and whether the system can honestly be called production-ready.

**Honest verdict up front:** **Not yet production-ready for live public
posting.** The P0 data-integrity, security, rights, isolation, capability-gating,
media-safety and rate-limiting work is done and tested, but (a) **no external
network integration is `LIVE_VERIFIED`** — see `PRODUCTION_READINESS_AUDIT.md` —
and (b) the P1/P2 items (observability, recovery runbooks, AI evaluation,
staging, expanded CI) are not yet done. It is suitable for an **internal/staging
pilot** that prepares drafts and never auto-posts publicly.

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

**Test totals:** 58 unit tests + 24 integration tests (real Postgres + Redis +
ffmpeg). `typecheck`, `lint`, and the production `build` pass. A real end-to-end
render produces a genuine 1080×1920 H.264/AAC MP4 + thumbnail with 21+ compliance
checks executing, including the new `sourcePermission=REVIEW` gate.

## 2. Migrations added

`idempotency_state_versions`, `rights_provenance`, `metrics_and_earnings`
(earlier), `multitenant_workspace`, plus the pre-existing phase migrations. All
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

## 5. Unresolved risks / remaining work (P1 + P2 — NOT done)

- **P1-8 AI evaluation harness** — there is still no measurement of extraction
  accuracy or false-PASS rate. "Valid Zod output" ≠ correct. **This is a launch
  blocker for trusting automated compliance.**
- **P1-9 Observability & recovery** — no correlation IDs, metrics, tracing, or
  dead-letter workflow yet; no graceful worker shutdown for in-flight ffmpeg/uploads.
- **P1-10 Encryption key rotation** — single-version AES key; no rotation runbook.
- **P1-11 Expanded CI** — no containerised Postgres/Redis CI, migration/backup
  tests, render golden files, or dependency scan gate.
- **P1-12 Staging mode** — no separate staging config / prod-credential guard.
- **P2-13..16** — perceptual/audio duplicate detection (columns exist, logic
  pending), cost/capacity controls & kill switches, operator pre-publication
  screen with override audit, disaster-recovery validation.
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

## 8. Monitoring checklist (targets; instrumentation is P1-9, pending)

Queue depth & latency per stage · job failure/retry/dead-letter counts · parse
confidence & manual-review rate · render duration/cost · provider API latency/
failure · publication/submission status · estimated vs confirmed earnings.

## 9. Security checklist

- [x] SSRF guard, download host allowlist, size/type caps, media probe-gate
- [x] AES-256-GCM secret encryption; log redaction; secrets in env only
- [x] RBAC; signed HttpOnly session cookies; CSRF (same-origin) + Redis rate limits
- [x] Multi-tenant isolation on signed URLs, mutations, and reads
- [x] Rights/provenance gate (no unauthorised media use; unknown → REVIEW)
- [x] Optimistic concurrency + state machines (no dup publish / stale overwrite)
- [ ] Encryption key rotation (P1-10) · dependency vuln scan gate (P1-11)
- [ ] Pen-test / external security review

## 10. Launch blockers (must clear before public, auto-posting launch)

1. No integration is `LIVE_VERIFIED` — verify each against the real provider.
2. TikTok/IG/YouTube provider approvals outstanding.
3. AI extraction/compliance accuracy is unmeasured (P1-8).
4. No production observability or disaster-recovery validation (P1-9, P2-16).

**Cleared for:** internal/staging pilot in **draft/manual** mode (no public AUTO
posting), which the capability gating enforces by default.

_Update this report as P1/P2 land; do not upgrade the verdict while any launch
blocker above remains._
