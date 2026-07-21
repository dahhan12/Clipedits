# Operational Runbooks

Practical procedures for running CampaignClipper in staging/production. Each
runbook is a symptom → diagnosis → action sequence. All admin actions are
audited (`AuditEvent`); prefer the documented controls over ad-hoc DB edits.

Related docs: `DISASTER_RECOVERY.md`, `SECRET_ROTATION.md`,
`PRODUCTION_READINESS_AUDIT.md`, `PRODUCTION_RELEASE_REPORT.md`.

---

## 0. Emergency stop (halt spend now)

**When:** runaway publishing/rendering, a provider incident, suspected abuse, or
a cost spike.

1. Open **/observability** as an ADMIN.
2. In **Kill switches & spend cap**, click **Halt** on `publishing` and/or
   `rendering` and/or `ai`. Effect is near-immediate (≤5s read-through cache).
   - `publishing` halted → `publishClip` returns `SKIPPED` (never a fabricated
     post).
   - `rendering` halted → `renderCandidate` no-ops (nothing spent).
3. Optionally set a **Global daily cap (USD)** to bound further spend.
4. To release, click **Release** on each area. All toggles are audited
   (`killswitch.engaged` / `killswitch.released`).

CLI/DB fallback (if the UI is unavailable): set `SystemSetting` key
`killswitch.publishing` = `"true"`.

---

## 1. A worker is down / not processing

**Symptoms:** queue depth climbing on **/observability**, jobs stuck in
`waiting`, no recent `job completed` logs.

1. Check which queue is backed up (Queue depths table).
2. Confirm the corresponding worker process is running:
   `npm run worker:pipeline` / `worker:render` / `worker:publish` /
   `worker:submission` / `worker:discovery`.
3. Check Redis connectivity — workers log `ECONNREFUSED :6379` when Redis is
   down. Restore Redis first.
4. Restart the worker. Shutdown is graceful (`SIGTERM`/`SIGINT` drain active
   jobs via `worker.close()`), so a rolling restart will not abandon in-flight
   ffmpeg/uploads.
5. Idempotency guarantees a restart never double-processes: every unit of work
   is wrapped in a `JobRun` keyed on `(queue, jobKey)`; a `SUCCEEDED` run is
   skipped on retry.

---

## 2. Dead-letter triage

**Symptoms:** items in the **Dead letters** table on /observability.

1. Read the **Category** badge (from `failureCategory`):
   - `TRANSIENT_NETWORK` / `RATE_LIMITED` / `TIMEOUT` → retryable; the failure
     was environmental.
   - `RIGHTS_DENIED` / `MEDIA_INVALID` / `PROVIDER_REJECTED` / `CONFIG_MISSING`
     / `NOT_FOUND` / `UNKNOWN` → not auto-retryable; the underlying cause must be
     fixed first.
2. For retryable items, click **Replay** — it resets the `JobRun` and
   re-enqueues via the shared dispatcher (`job.replay` audited).
3. For non-retryable items, fix the root cause (verify rights, re-render valid
   media, set the missing env/secret, reconnect the provider), then use **Force
   replay** (audited as `job.replay.forced`). Do NOT force-replay blindly —
   it will just re-fail and burn quota.

---

## 3. Queue backlog / throughput

**Symptoms:** large `waiting` counts that are not draining.

1. Confirm workers are healthy (Runbook 1).
2. Increase worker concurrency for the hot stage (the `concurrency` option in
   the relevant `*.worker.ts`) and scale horizontally — job ids are
   deterministic, so multiple worker processes cannot double-process.
3. Check the **Provider API metrics (7d)** panel: a high `error rate` or `avg
   ms` on a provider means an upstream slowdown is the bottleneck, not workers.
4. If the backlog is publish/render and spend is the concern, set a spend cap
   rather than letting it drain uncontrolled.

---

## 4. Compliance is blocking everything / clip stuck in REVIEW

1. Open the clip at **/clips/{id}** and read the **Compliance** table.
2. A `FAIL` is a hard block — fix and re-render; it is never overridable.
3. A `REVIEW` is a soft gate. If the operator has manually verified the item, an
   ADMIN can use the **Operator review · override** panel: acknowledge each
   waivable REVIEW, enter a justification, and approve. Safety-critical REVIEWs
   (rights/provenance, prohibited content, duplicates) are **not** overridable —
   resolve them at the source.
4. Every override is recorded as `PrePublicationReview` + `clip.review.approved`
   audit; the publish audit records the `overrideId`.

---

## 5. A campaign keeps producing after it should have stopped

1. Stop conditions auto-PAUSE a campaign after a publish when it hits its post
   cap, exhausts budget, or passes its deadline (`campaign.autopaused` audit).
2. If a campaign is still active past a limit, run a publish (or manually invoke
   `applyCampaignStopConditions`) — the check runs post-publish.
3. To hard-stop immediately, PAUSE/CLOSE the campaign (guarded transition) or
   engage the publishing kill switch (Runbook 0).

---

## 6. Spend cap reached unexpectedly

**Symptom:** publishes/renders returning `SKIPPED` with "Daily cost cap reached".

1. Check the **Estimated spend (7d)** table on /observability for the workspace.
2. Costs are ESTIMATES (per-op rates in `costService.RATES`), used only for soft
   caps — they are not billing figures. Confirm the estimate is plausible.
3. Raise or clear the **Global daily cap**, or the per-workspace
   `Workspace.dailyCostCapUsd`, if the spend is legitimate.
4. If the spend is a runaway loop, keep the cap and investigate via the
   dead-letter table and correlation-id logs before releasing.

---

## 7. Secret / key rotation

See `SECRET_ROTATION.md`. Summary: set the new active key (`ENCRYPTION_KEY` +
`ENCRYPTION_KEY_ID`), keep the prior key in `ENCRYPTION_KEYS_RETIRED` for
decryption, run `npm run rotate:secrets` to re-wrap stored secrets, then retire
the old key once `needsRewrap` reports zero remaining.

---

## 8. Database migration in production

1. Never run `prisma migrate dev` in prod. Use `npm run prisma:deploy`
   (`prisma migrate deploy`) which applies committed migrations only.
2. Take a backup first (`DISASTER_RECOVERY.md` §Backups).
3. After deploy, run `npm run dr:verify` against the DB to confirm the schema is
   in sync and core tables are queryable.

---

## 9. Provider outage (TikTok / Instagram / YouTube / Anthropic / Whisper)

1. Confirm via the **Provider API metrics** panel (error rate spike) and the
   provider's status page.
2. Engage the relevant kill switch (`ai` for model outages; `publishing` for a
   platform outage) to stop generating dead letters.
3. Affected jobs will dead-letter as `PROVIDER_REJECTED` / `TRANSIENT_NETWORK` —
   replay them once the provider recovers (Runbook 2).
4. The system never falls back from a live provider to fabricated success — an
   outage produces honest failures, not fake posts/metrics.
