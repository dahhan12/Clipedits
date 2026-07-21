# Technical Debt Register — CampaignClipper

Categorised P0 → P3. **P0** = must fix before real campaigns / real money.
**P1** = before public or paying launch. **P2** = before meaningful scale.
**P3** = polish. Effort is rough engineering time for one experienced engineer.

This register is deliberately honest and includes debt that is *external*
(integration/approval) as well as *internal* (code/infra). Several P0/P1 items
are not code smells — they are missing verification that the product's core
promise depends on.

---

## P0 — blocks real campaigns / real money

### P0-1 · No integration is `LIVE_VERIFIED`
- **Description.** Every external adapter (TikTok, Instagram, YouTube, Anthropic,
  Whisper, R2, Content Rewards, Whop) is exercised in sandbox or via untested
  live code paths. None has been run against the real provider end-to-end.
- **Impact.** The product's central claim — "publishes compliant clips and
  tracks earnings" — is unproven. Silent breakage on first real use.
- **Solution.** Stand up credentials in staging; run each adapter against the
  real API; record a `LIVE_VERIFIED` result per provider in the readiness audit.
- **Effort.** 1–2 weeks (gated partly on external approvals).

### P0-2 · Platform posting approvals outstanding
- **Description.** TikTok Content Posting API, Instagram Graph publishing, and
  YouTube Data API all require app review/verification for public posting.
- **Impact.** Without approval the system can only prepare DRAFTs; public
  auto-posting is impossible regardless of code quality.
- **Solution.** Submit each app for review; document scopes obtained; wire the
  approved credentials behind the existing capability gating.
- **Effort.** Days of work, weeks of external review latency.

### P0-3 · AI extraction accuracy unproven against the live model
- **Description.** The eval harness (`falsePassRate`, `criticalFieldAccuracy`,
  contradiction/hallucination metrics) exists but a **LIVE** run against the real
  model has not been recorded — `npm run eval` needs `ANTHROPIC_API_KEY`.
- **Impact.** Compliance trusts extracted rules; an un-benchmarked extractor can
  approve non-compliant clips (a false-PASS is the worst failure mode).
- **Solution.** Run the LIVE eval, meet thresholds, record the report; wire the
  eval as a release gate.
- **Effort.** 1–2 days once a key is available.

### P0-4 · Money is estimated, never metered/confirmed
- **Description.** Costs use static per-op rates; earnings use CPM math. Neither
  is reconciled against real token usage or confirmed payouts.
- **Impact.** Cannot bill customers or report earnings truthfully; caps protect
  runaway spend but are not accounting.
- **Solution.** Meter real token counts (Anthropic usage) and real render
  minutes; reconcile earnings against the portal's confirmed payout data before
  showing money figures as anything but estimates.
- **Effort.** 1–2 weeks.

---

## P1 — before public / paying launch

### P1-1 · No load/scale testing
- **Description.** Throughput ceilings are unmeasured.
- **Impact.** Unknown behaviour under concurrency; first-incident risk.
- **Solution.** k6/Artillery harness against staging; baseline p95 + queue
  stability. (See `PERFORMANCE_AUDIT.md` #1.)
- **Effort.** 3–5 days.

### P1-2 · Render throughput ceiling (concurrency = 1)
- **Description.** Single-process CPU-bound FFmpeg is the throughput bottleneck.
- **Impact.** Renders/hour is capped by one core; the product's slowest stage.
- **Solution.** Horizontal render fleet; size from the load test. (Perf #3.)
- **Effort.** 2–3 days (mostly deploy/infra).

### P1-3 · DB connection pooling undefined
- **Description.** No PgBouncer / documented `connection_limit` for the
  web + five worker pools.
- **Impact.** Connection exhaustion when workers scale out.
- **Solution.** PgBouncer transaction pooling; document the connection math.
- **Effort.** 1–2 days.

### P1-4 · Unbounded append-only tables
- **Description.** `AuditEvent`, `ProviderStat`, `UsageCounter` have no retention.
- **Impact.** Table bloat, vacuum pressure, slow analytics at scale.
- **Solution.** Retention job or monthly partitioning. (Perf #2.)
- **Effort.** 2–3 days.

### P1-5 · Discovery depends on browser scraping
- **Description.** Discovery/parse/submission use authenticated Playwright
  automation of third-party sites; no official API.
- **Impact.** Fragile to markup changes; ToS/legal risk; a hidden operational
  burden (session/cookie upkeep, bot detection).
- **Solution.** Pursue official/partner APIs where they exist; isolate the
  scraping behind a clearly-flagged adapter with health checks and alerting;
  treat markup breakage as a first-class monitored failure.
- **Effort.** Ongoing; days to harden, longer to replace.

### P1-6 · Multi-tenant isolation not re-verified in workers
- **Description.** `workspaceId` scopes queries, but queue payloads don't carry
  it, so workers don't re-verify tenancy (mitigated: enqueue routes are
  ownership-checked).
- **Impact.** A future enqueue path that forgets the ownership check could cross
  tenants.
- **Solution.** Put `workspaceId` in the job payload and assert it in
  `withJobRun`; add a defence-in-depth test.
- **Effort.** 1–2 days.

### P1-7 · No test-coverage measurement / gate
- **Description.** 113 unit + 42 integration tests exist, but line/branch
  coverage is not measured or gated in CI.
- **Impact.** Coverage regressions land silently; blind spots invisible.
- **Solution.** `vitest --coverage` with a floor in CI (start at the current
  level, ratchet up). Expect provider adapters to be the weak spot.
- **Effort.** 1 day.

---

## P2 — before meaningful scale

### P2-1 · Perceptual de-dup linear scan
- **Description.** O(n) in-app Hamming comparison over a campaign's published
  clips. (Perf #4.)
- **Impact.** Compliance latency grows with campaign size.
- **Solution.** LSH/bktree index or bounded candidate set.
- **Effort.** 3–5 days.

### P2-2 · Sequential I/O hotspots
- **Description.** Sequential downloads (ingestion), per-platform permission
  queries (compliance), discovery upserts, `getProviderMetrics` N+1. (Perf
  #5–#8.)
- **Impact.** Added wall-clock latency; none are correctness issues.
- **Solution.** Bounded-concurrency parallelism / `Promise.all` / single grouped
  query, preserving idempotency.
- **Effort.** 1–2 days total.

### P2-3 · No content cache for identical re-parse
- **Description.** Unchanged page text still re-calls the model on re-parse.
- **Impact.** Avoidable model spend. (Perf #9.)
- **Solution.** Short-circuit on unchanged `pageHash` with an existing rule.
- **Effort.** Half a day.

### P2-4 · OpenTelemetry tracing deferred
- **Description.** Correlation-id log tracing exists; no distributed spans.
- **Impact.** Cross-service latency attribution is manual.
- **Solution.** Wire OTel to a chosen collector (Tempo/Honeycomb).
- **Effort.** 2–3 days once the backend is chosen.

### P2-5 · No alerting on the observability signals
- **Description.** Dashboards expose queue depth, dead letters, provider error
  rates, spend — but nothing pages a human.
- **Impact.** Failures are visible only if someone looks.
- **Solution.** Alert rules on dead-letter count, provider error-rate, queue
  depth, cap breaches.
- **Effort.** 2–3 days.

---

## P3 — polish

### P3-1 · Dashboard UX is functional, not refined
- **Description.** Server-rendered tables; adequate but not a designed product UI.
- **Impact.** Fine for operators; not customer-facing quality.
- **Solution.** Design pass if the dashboard becomes a customer surface.
- **Effort.** Variable.

### P3-2 · A few micro-duplications remain
- **Description.** Platform-cast helpers (`p as Platform`, `platformKey`) repeat
  across compliance/publish; a shared typed narrowing would DRY them.
- **Impact.** Cosmetic.
- **Solution.** One shared `toPlatform`/`isPlatform` guard.
- **Effort.** ~1 hour.

### P3-3 · Cost rates are hard-coded constants
- **Description.** `RATES` in `costService` are literals.
- **Impact.** Rate changes need a deploy.
- **Solution.** Move to `SystemSetting` if rates need runtime tuning (only if
  P0-4 metering doesn't supersede it).
- **Effort.** Half a day.

---

## Debt paid during this audit (post-freeze)

- **`playwright` mis-scoped as devDependency** while used at runtime by the
  discovery/parse/submission workers — a production `npm ci --omit=dev` would
  have crashed those workers. Moved to `dependencies`. *(Was an undetected P0.)*
- **Transitive high/moderate CVEs** (`sharp` via unused `next/image`, `postcss`
  build-time) cleared via npm `overrides` without the catastrophic `next@9`
  downgrade. Prod high+ audit now 0.
- **Duplicated `utcToday()` helper** extracted to `src/lib/time.ts`.
