# CampaignClipper — Release Report `v1.0.0-alpha`

**Release candidate freeze.** Tag `v1.0.0-alpha` marks the frozen milestone at
commit `f473e27`. Post-freeze audit fixes (dependency scope, transitive CVEs,
DRY cleanup) land on top on `claude/campaignclipper-typescript-app-3d00tt` and
are documented here and in `TECHNICAL_DEBT.md` / `PERFORMANCE_AUDIT.md` /
`FINAL_VERDICT.md`.

> **Note on the tag:** the annotated tag exists locally at `f473e27`. This
> session's GitHub credentials are scoped to the feature branch only, so the tag
> could not be pushed (`refs/tags/*` returns 403). Re-create it from a session
> with push rights: `git tag -a v1.0.0-alpha f473e27 -m "…" && git push origin v1.0.0-alpha`.

---

## 1. Executive summary

CampaignClipper discovers Content-Rewards-style campaigns, extracts validated
rules, downloads permitted assets, generates compliant 9:16 short-form videos,
prepares/publishes them, and tracks submissions and (estimated) earnings. It is
built as a strict-TypeScript Next.js 15 app with PostgreSQL/Prisma, Redis/BullMQ
workers, FFmpeg/Remotion rendering, and an Anthropic-backed extraction layer.

The system is **feature-complete** across its five pipeline phases plus a full
production-hardening pass (data integrity, rights/provenance, multi-tenant
isolation, platform-capability gating, media hardening, distributed rate
limiting, an AI evaluation harness, observability + recovery, encryption
rotation, expanded CI, staging guard, perceptual de-duplication, cost controls +
kill switches, an operator override workflow, and DR runbooks).

**Honest status: suitable for an internal/staging pilot that prepares drafts;
NOT ready for live public auto-posting or handling real money.** The blocking
gaps are external, not internal: **no platform/provider integration has been
verified against a real API (`LIVE_VERIFIED`)**, and TikTok/Instagram/YouTube
posting requires app review/approval that is outstanding. See §5, §8, §7.

- **Source size:** ~12,100 LOC (excl. generated Prisma client). Zero `any`, zero
  `TODO`/`FIXME` in application code, strict TS (`noUncheckedIndexedAccess`).
- **Tests:** 113 unit + 42 integration (real Postgres/Redis/FFmpeg in CI).
- **CI:** green for every commit at and before the freeze.

## 2. Architecture overview

```
 Discovery ─▶ Parse ─▶ Ingest ─▶ Transcribe ─▶ Clip ─▶ Render ─▶ Compliance ─▶ Publish ─▶ Submit ─▶ Track
   (BullMQ queues; each stage a worker; every unit of work an idempotent JobRun keyed on (queue, jobKey))
```

- **Web/App:** Next.js 15 App Router (server components + route handlers),
  React 19. `instrumentation.ts` validates the deployment tier at startup.
- **Data:** PostgreSQL + Prisma (client generated to `src/generated/prisma`).
  Optimistic concurrency (version columns + version-checked `updateMany`), state
  machines with guarded transitions, deterministic unique keys for idempotency.
- **Queues/Workers:** Redis + BullMQ. Five worker entrypoints
  (`discovery`, `pipeline`, `render`, `publish`, `submission`). Graceful
  shutdown drains in-flight jobs; exhausted retries dead-letter with a
  classified category and a safe replay path.
- **Rules as contract:** a single Zod `CampaignRulesSchema` is the source of
  truth. LLM output is always re-validated; "valid Zod output is not proof of
  correctness" — hence the eval harness.
- **Media:** FFmpeg (verified real 1080×1920 H.264/AAC) with a Remotion overlay
  path and FFmpeg burn-in fallback; perceptual + audio fingerprints for
  near-duplicate detection.
- **Security:** scrypt password hashing, HMAC-signed session cookies, RBAC,
  same-origin CSRF, distributed (Redis) rate limiting, AES-256-GCM envelope
  encryption with key versioning/rotation, SSRF-guarded outbound fetches, pino
  secret redaction.
- **Adapters:** honest sandbox vs live providers — a sandbox adapter never
  fabricates success, and the system never silently falls back from a live
  provider to a fake result.

Full detail: `ARCHITECTURE.md`.

## 3. Completed phases

| Phase | Scope | State |
| ----- | ----- | ----- |
| 1 | Discovery, parsing, DB schema, dashboard | ✅ |
| 2 | Resource ingestion, transcription, clip-candidate generation | ✅ |
| 3 | 9:16 FFmpeg/Remotion rendering + deterministic compliance | ✅ |
| 4 | Publishing (platform adapters + capability gating) | ✅ |
| 5 | Submission, tracking, estimated earnings | ✅ |
| P0 | Reality audit, DB idempotency/state, rights/provenance, multi-tenant isolation, capability gating, media hardening, distributed rate limiting | ✅ |
| P1 | AI eval harness, observability + graceful shutdown + dead-letter, encryption rotation, expanded CI, staging guard | ✅ |
| P2 | Perceptual de-dup, cost controls + kill switches, operator override + audit, DR runbooks + `dr:verify` | ✅ |

Deferred by design: **OpenTelemetry distributed tracing** (needs a collector
backend decision; correlation-id log tracing covers the gap today).

## 4. Remaining limitations

- No integration is `LIVE_VERIFIED`; all provider adapters are exercised in
  sandbox or against untested live code paths.
- Discovery depends on **authenticated browser automation (Playwright)** of
  third-party sites — fragile to markup changes and subject to each site's ToS;
  there is no official discovery API.
- Cost/earnings figures are **estimates** (per-op rates / CPM math), not metered
  from real token counts or confirmed payouts.
- Append-only tables (`AuditEvent`, `ProviderStat`, `UsageCounter`) have **no
  retention/partitioning** — unbounded growth at scale.
- No load/scale testing has been performed.
- Single-region assumptions; PITR/WAL archiving is recommended but not wired.

## 5. Verified integrations

**None are `LIVE_VERIFIED`.** The following are *internally* verified only:

| Capability | Verified how | Confidence |
| ---------- | ------------ | ---------- |
| FFmpeg render (1080×1920 H.264/AAC + thumbnail) | real binary in CI + smoke render | **High** |
| Perceptual/audio de-dup | real FFmpeg integration test (re-encode matches, distinct separates) | **High** |
| Postgres schema + 11 migrations from scratch | `migrate deploy` in CI | **High** |
| Auth / CSRF / RBAC / rate limiting | unit + integration against real Redis | **High** |
| Envelope encryption + rotation | unit (roundtrip, AAD-tamper reject, legacy, rewrap) | **High** |

## 6. Sandbox integrations

Honest sandbox adapters (never fabricate success), pending live verification:

- **Anthropic** extraction/vision — live path exists; accuracy gated by the eval
  harness, which requires an API key + a passing LIVE run recorded before trust.
- **Whisper** transcription — live HTTP path exists; sandbox transcriber used
  without a key.
- **TikTok / Instagram Reels / YouTube Shorts** publishing — real API code paths
  exist but are **untested against the real platforms** and require app
  approval; without credentials they prepare local DRAFTs.
- **Content Rewards / Whop** discovery + submission-status — browser-automation
  and portal polling; not validated end-to-end against the live portals.
- **Cloudflare R2** object store — real S3-compatible path; local store used in
  sandbox.

## 7. Platform restrictions

- **TikTok:** Content Posting API requires an approved, audited app; direct-post
  needs additional review. Un-audited apps can only reach the inbox/DRAFT flow.
  Analytics need the Display/Research scope.
- **Instagram Reels:** Graph API ingests by public `video_url` and requires a
  Business/Creator account + `instagram_content_publish`; insights need
  `instagram_manage_insights`.
- **YouTube Shorts:** Data API v3 upload requires OAuth + quota; unverified apps
  face upload/quota caps and default to `private`.
- Capability gating enforces this: off-prod tiers and un-connected/unaudited
  providers are forced to DRAFT — the system will not claim to have posted.

## 8. Security posture

**Strong for a staging pilot; not yet externally assured.**

- **AuthN:** scrypt password hashing (salt embedded), HMAC-signed session
  cookies. **AuthZ:** RBAC (`ADMIN`/`OPERATOR`/`VIEWER`) enforced in route
  handlers; ADMIN-only kill switches and override approvals.
- **Transport/session:** same-origin CSRF enforcement (middleware); rate
  limiting is authoritative in Redis with a coarse per-instance edge layer.
- **Secrets:** AES-256-GCM envelope encryption with key versioning + rotation
  script; key id bound as GCM AAD; pino redaction on sensitive keys; secrets
  stored encrypted (useless without the key material, kept out of DB backups).
- **SSRF:** outbound fetches validated against a blocklist (loopback,
  private/link-local, `169.254.169.254` metadata).
- **Supply chain:** CI gates on `npm audit --omit=dev --audit-level=high`.
  Post-freeze, freshly-published transitive advisories (`sharp` via unused
  `next/image`, `postcss` build-time) were cleared via npm `overrides` — prod
  high+ audit is now **0**. `playwright` was corrected from a devDependency to a
  runtime dependency (it is used by the discovery/parse/submission workers).
- **Gaps:** no external penetration test; multi-tenant isolation is enforced at
  the query layer (`workspaceId`) but queue payloads don't yet carry
  `workspaceId` for worker-side re-verification (mitigated: enqueue routes are
  ownership-checked).

## 9. Test results

- **Unit:** 113 passing (`vitest`). Covers schemas, validators, compliance
  roll-up, failure classification, perceptual hashing, cost/stop-conditions,
  review gating, envelope crypto, eval scoring.
- **Integration:** 42 (real Postgres + Redis + FFmpeg in CI); self-skip without
  those services. Covers idempotency/concurrency, media validation, rights,
  multi-tenant scoping, rate limiting, dead-letter capture/replay, pre-publication
  review, cost controls/kill switches, and real FFmpeg perceptual hashing.
- **Eval:** extraction eval harness with a headline **falsePassRate** metric;
  `npm run eval` fails only on a LIVE miss (needs `ANTHROPIC_API_KEY`).
- **Static:** `tsc --noEmit`, `next lint`, and production `next build` all pass.

## 10. Coverage summary

Numeric line coverage is **not currently measured** (no coverage gate in CI —
see `TECHNICAL_DEBT.md` P2). Qualitatively: the deterministic core (compliance
validators, state machines, idempotency, failure classification, crypto, cost,
review gating, perceptual hashing) is well covered by fast unit tests; the
stateful pipeline seams (publish gate, dead-letter, multi-tenant scope) are
covered by DB-backed integration tests. External provider adapters are the least
covered — by design, pending live verification.

## 11. Database migrations

11 migrations apply cleanly from scratch (`migrate deploy`, verified in CI):

```
20260721114632_init
20260721121054_manual_campaign_source
20260721122205_enrich_rules_and_rendered_clip
20260721122803_metrics_and_earnings
20260721123630_users_workspaces
20260721162619_idempotency_state_versions
20260721163400_rights_provenance
20260721165527_multitenant_workspace
20260721170500_dead_letter_and_provider_stats
20260721180000_prepublication_review
20260721183000_cost_controls_kill_switches
```

## 12. Deployment instructions

1. Provision managed Postgres + Redis + R2. Set env (`.env.example`); generate
   `ENCRYPTION_KEY`/`ENCRYPTION_KEY_ID` and `SESSION_SECRET`.
2. `npm ci` (installs the runtime `playwright`; provide a Chromium via
   `npx playwright install chromium` or a base image with it).
3. `npx prisma migrate deploy && npm run build`.
4. `npm run seed:admin` (first ADMIN; store the printed password).
5. Start the app and the five workers (`npm run worker:*`).
6. Set `APP_ENV=staging|production`; the deploy-tier guard blocks prod approvals
   in local/CI and requires secrets in staging/prod.
7. Post-restore or post-migrate, run `npm run dr:verify`.

## 13. Rollback instructions

- **App:** redeploy the previous image/build; the frozen RC is `f473e27`
  (`v1.0.0-alpha`).
- **Database:** migrations are additive; a bad deploy rolls back by deploying the
  prior app version (which does not use the new columns). For a destructive
  migration, restore from backup (`DISASTER_RECOVERY.md`) to the pre-migration
  point, then redeploy the matching app version. Never run `migrate reset` in
  prod.
- **Kill switch:** if a live incident is publish/spend-related, engage the
  publishing/rendering kill switch (`RUNBOOKS.md` §0) — instant, no redeploy.
- **Verification:** `npm run dr:verify` before re-opening traffic.

## 14. Release checklist

- [x] All phases + P0/P1/P2 implemented and committed in priority order
- [x] `typecheck` / `lint` / `build` green
- [x] 113 unit + 42 integration tests green in CI
- [x] 11 migrations apply from scratch in CI
- [x] Prod dependency audit (high+) clean
- [x] Runbooks + DR plan + `dr:verify` present
- [x] Honest release report (this doc)
- [ ] At least one integration `LIVE_VERIFIED` against a real provider
- [ ] TikTok/Instagram/YouTube app approvals obtained
- [ ] LIVE eval run recorded against the real model (thresholds met)
- [ ] Load/scale test at target concurrency
- [ ] External security review / pen-test
- [ ] Metered (not estimated) cost + billing
- [ ] Retention/partitioning for append-only tables
- [ ] OpenTelemetry tracing wired to a collector

**Verdict:** ship to an internal/staging pilot now; do **not** enable public
auto-posting or real-money flows until the unchecked items above are closed.
