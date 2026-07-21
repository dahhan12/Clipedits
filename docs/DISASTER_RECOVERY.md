# Disaster Recovery

How to back up, restore, and validate CampaignClipper's stateful stores. Pair
this with `RUNBOOKS.md` for day-to-day operations.

## 1. What holds state

| Store | Contents | Criticality | Recoverable from |
| ----- | -------- | ----------- | ---------------- |
| **PostgreSQL** | campaigns, rules, assets metadata, clips, compliance, publications, submissions, earnings, audit log, `JobRun`, `UsageCounter`, `SystemSetting`, users/workspaces, encrypted secrets | **Critical** — source of truth | backups only |
| **Object store (R2/local)** | source assets, rendered MP4s, thumbnails | **High** — large, re-derivable at cost | backups; renders can be re-produced from sources if sources survive |
| **Redis (BullMQ)** | in-flight queue state | **Low** — transient | not backed up; rebuilt by re-enqueue |
| **Secrets/env** | `ENCRYPTION_KEY` (+ `ENCRYPTION_KEYS_RETIRED`), `SESSION_SECRET`, provider creds | **Critical** | secret manager (out of band) |

Redis is intentionally disposable: idempotent `JobRun` keys mean re-enqueuing
lost jobs never double-processes, so Redis needs no PITR.

## 2. Targets

- **RPO (max data loss):** ≤ 24h with daily logical backups; ≤ 5 min if
  Postgres PITR / WAL archiving is enabled (recommended for production).
- **RTO (max downtime):** ≤ 1h — restore Postgres, point the app at it, redeploy
  workers, run `dr:verify`.

## 3. Backups

**PostgreSQL (daily minimum; PITR recommended):**

```bash
# Logical backup
pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump
# Managed Postgres: enable automated backups + WAL archiving for PITR.
```

**Object store (R2):** enable bucket versioning + lifecycle, or replicate to a
second bucket/region. Renders are re-derivable from source assets, so prioritise
backing up **source** assets.

**Secrets:** store `ENCRYPTION_KEY` (+ retired keys) and `SESSION_SECRET` in a secret manager,
NOT in the DB backup. A DB backup contains AES-GCM-encrypted secrets that are
useless without the keys — losing the keys means losing every stored provider
credential (rotate/reconnect required).

## 4. Restore procedure

1. Provision a fresh Postgres and restore the dump:
   ```bash
   pg_restore -d "$NEW_DATABASE_URL" --clean --if-exists backup-YYYY-MM-DD.dump
   # or restore to a PITR timestamp via your managed provider.
   ```
2. Provision/attach the object store (or restore the bucket).
3. Set env from the secret manager (`ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID`,
   `ENCRYPTION_KEYS_RETIRED`, `SESSION_SECRET`, `DATABASE_URL`, `REDIS_URL`,
   `R2_*`, provider creds).
4. Bring up a fresh Redis (empty is fine).
5. Apply any migrations newer than the backup: `npm run prisma:deploy`.
6. **Validate before cutover:** `DATABASE_URL=... npm run dr:verify`.
7. Start workers (`worker:*`) and the app. Re-enqueue any work that was in-flight
   at failure time (discovery re-run + the pipeline is idempotent).

## 5. Validation — `npm run dr:verify`

`scripts/dr-verify.ts` is a restore smoke-test to run against the **restored**
DB (and object store) before taking traffic. It checks, and exits non-zero on
any failure:

1. **database connectivity** — `SELECT 1`.
2. **migrations applied** — `prisma migrate status` reports no pending/failed
   migrations or drift.
3. **core tables queryable** — counts campaigns / rendered clips / publications /
   job runs.
4. **read/write round-trip** — a self-cleaning `SystemSetting` canary
   (write → read-back → delete).
5. **object store round-trip** — writes a canary object and reads it back,
   proving the store is reachable and read-consistent.

It never mutates real data beyond the self-cleaning canaries. A clean run is the
go/no-go signal for cutover.

## 6. Post-restore checks

- Confirm the **/observability** dashboard renders (queue depths, funnel).
- Confirm secrets decrypt: load a page that reads a provider credential, or run
  `rotate:secrets` in dry-run to confirm `ENCRYPTION_KEYS` matches the data.
- Release any kill switches that were engaged during the incident.
- Reconcile the audit log for the incident window.

## 7. Drill cadence

Run a restore drill into a scratch environment at least quarterly: restore the
latest backup, run `dr:verify`, spot-check a campaign end-to-end, and record the
achieved RTO. Update targets here if drills reveal drift.
