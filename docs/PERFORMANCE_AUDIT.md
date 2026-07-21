# Performance Audit — CampaignClipper

Scope: the full pipeline (discovery → track), the data layer, queues, Redis,
Anthropic usage, and rendering. This audit reflects **static analysis + code
review**, not a load test — no load/scale testing has been run, which is itself
the top finding (P0 below). Findings are ordered by implementation priority.

Legend — Impact: how much it hurts at scale. Priority: P0 (do before paying
customers) · P1 (before meaningful scale) · P2 (opportunistic) · P3 (cosmetic).

---

## Summary table

| # | Finding | Area | Impact | Priority |
| - | ------- | ---- | ------ | -------- |
| 1 | No load/scale testing exists | whole system | Unknown ceiling | **P0** |
| 2 | Append-only tables unbounded (`AuditEvent`, `ProviderStat`, `UsageCounter`, `JobRun`) | DB | Table bloat, slow scans | **P1** |
| 3 | Render worker concurrency = 1; CPU-bound FFmpeg | rendering | Throughput ceiling | **P1** |
| 4 | Perceptual de-dup does an in-app linear scan of published clips per campaign | compliance/DB | O(n) per compliance eval | **P1** |
| 5 | Sequential resource downloads per campaign | ingestion | Wall-clock latency | **P2** |
| 6 | `getProviderMetrics` N+1 (`findFirst` per provider/op row) | dashboard | Extra queries on a rarely-hit page | **P2** |
| 7 | `worstPermission` issues up to 3 sequential permission queries | compliance | Minor added latency | **P2** |
| 8 | Discovery upserts campaigns sequentially | discovery | Batch latency | **P2** |
| 9 | Anthropic calls deduped only by JobRun idempotency (no content cache) | AI/cost | Repeat spend on re-parse of identical text | **P2** |
| 10 | No DB connection-pool tuning documented (PgBouncer) | DB | Connection exhaustion at worker scale | **P1** |

---

## Findings & recommendations

### 1. No load/scale testing — **P0**
**Finding.** The system is correct under unit/integration tests but has never
been exercised at target throughput (concurrent workspaces, campaigns/day,
renders/hour). All scale claims are theoretical.
**Recommendation.** Add a k6/Artillery harness that drives the queues at target
rates against a staging stack; capture p50/p95 stage latency, queue depth
stability, DB CPU, and render throughput. Establish a baseline before any
public/paying launch.
**Expected impact.** Converts "we think it scales" into measured limits; surfaces
the real bottleneck (almost certainly rendering, see #3).

### 2. Unbounded append-only tables — **P1**
**Finding.** `AuditEvent`, `ProviderStat`, `UsageCounter`, and completed
`JobRun`s grow without retention. `AuditEvent` in particular gets a row per
meaningful state change — at 1M rendered clips this is tens of millions of rows.
Indexes exist (`entityType,entityId`; `createdAt`) but the table still bloats.
**Recommendation.** Add a retention job (e.g. drop `AuditEvent` > 180d, aggregate
`ProviderStat`/`UsageCounter` monthly) or native Postgres partitioning by month.
BullMQ already trims completed/failed jobs (`removeOnComplete: 1000`,
`removeOnFail: 5000`); mirror that discipline in the DB.
**Expected impact.** Keeps hot-path indexes small; prevents slow analytics scans
and vacuum pressure.

### 3. Render worker concurrency = 1 — **P1**
**Finding.** `render.worker.ts` runs FFmpeg at `concurrency: 1`. FFmpeg is
CPU-bound; a single worker process renders one clip at a time. This is the true
throughput ceiling of the product.
**Recommendation.** Scale horizontally — multiple render worker processes/pods,
each `concurrency: 1–2`, fronted by the shared queue (job ids are deterministic,
so no double-render). Size the render fleet from the load test (#1). Consider a
GPU/hardware-encode path for high volume.
**Expected impact.** Render throughput scales linearly with the fleet; this is
the single highest-leverage scaling change.

### 4. Perceptual de-dup linear scan — **P1**
**Finding.** `findPerceptualDuplicate` loads *every* already-published rendered
clip in the campaign (`perceptualHash != null`, `publications: { some } }`) and
compares Hamming distance in JS. That is O(n) rows per compliance evaluation and
grows with campaign size.
**Recommendation.** Acceptable at hundreds of clips/campaign; at 10k+ move to a
bit-sampling LSH index or a Postgres extension (e.g. `bktree`/`pg_similarity`) or
store hashes in a vector index. At minimum, cap the candidate set (recent N) and
add `@@index` support for the campaign-scoped hash lookup.
**Expected impact.** Turns an O(n) scan into ~O(log n)/bounded; keeps compliance
latency flat as campaigns grow.

### 5. Sequential resource downloads — **P2**
**Finding.** `downloadService` iterates resources and targets sequentially with
`await` per download. A campaign with many assets serializes network I/O.
**Recommendation.** Bounded-concurrency parallelism (e.g. `p-limit` of 3–5) over
targets; keep the checksum-idempotency and SSRF guard per item. Downloads are
already idempotent, so parallelism is safe.
**Expected impact.** Cuts ingestion wall-clock roughly by the concurrency factor
for multi-asset campaigns.

### 6. `getProviderMetrics` N+1 — **P2**
**Finding.** After a `groupBy`, the dashboard issues one `findFirst` per
(provider, operation) pair to fetch the latest error string. Dashboard-only, low
cardinality, but still N+1.
**Recommendation.** Fetch all recent non-null `lastError` rows in one query
ordered by `lastAt` and reduce in memory, or drop the per-row error and show it
on drill-down. Low effort.
**Expected impact.** Removes N extra round-trips from an admin page; negligible
at current cardinality, tidy at scale.

### 7. `worstPermission` sequential queries — **P2**
**Finding.** Compliance evaluates up to three platforms with a sequential
`await checkPermission` each.
**Recommendation.** `Promise.all` the per-platform checks and reduce to the
strictest outcome (ordering of the reduction is deterministic, so behaviour is
unchanged).
**Expected impact.** Shaves up to ~2 serial DB round-trips per compliance eval.

### 8. Sequential discovery upserts — **P2**
**Finding.** `runDiscovery` upserts each discovered campaign one at a time.
**Recommendation.** Batch with bounded concurrency, or `createMany`
+ targeted revision upserts. Discovery volume is currently low, so this is
opportunistic.
**Expected impact.** Faster discovery batches; matters only at high campaign
inflow.

### 9. Anthropic re-parse spend — **P2**
**Finding.** Re-parsing a campaign whose page text is unchanged re-calls the
model. `withJobRun` prevents *retry* duplication, but a genuine re-parse (page
hash unchanged) still spends.
**Recommendation.** Short-circuit parse when `CampaignRevision.pageHash` is
unchanged and a rule already exists for that hash; only call the model on drift.
**Expected impact.** Cuts avoidable model spend on stable campaigns; complements
the cost caps.

### 10. DB connection pool at worker scale — **P1**
**Finding.** Five worker processes plus the web app each open a Prisma pool.
Horizontally scaling workers multiplies Postgres connections; there is no
documented PgBouncer/pooling strategy.
**Recommendation.** Front Postgres with PgBouncer (transaction pooling) and set
Prisma `connection_limit` per process; document the math (processes ×
connection_limit ≤ Postgres max_connections).
**Expected impact.** Prevents "too many connections" failures as the render/parse
fleets scale — a classic first production incident.

---

## What is already good

- **Indexing is deliberate.** Every FK on a queried path is covered by an index
  or a composite unique prefix; the couple of unindexed FKs (`Publication.accountId`,
  `SourceAsset.resourceId`) are never used in a `where`, so they cost nothing today.
- **Idempotency is pervasive.** Deterministic job ids + `JobRun` guards + unique
  constraints mean retries and duplicate enqueues collapse — no wasted re-work.
- **Optimistic concurrency** (version columns + version-checked `updateMany`)
  avoids lock contention on hot rows.
- **BullMQ hygiene:** completed/failed job trimming, exponential backoff.
- **Media safety-before-work:** probe/validate before FFmpeg, hard timeouts that
  SIGKILL hostile inputs — protects worker CPU.
- **Metrics are aggregates,** not per-call tables (`ProviderStat`, `UsageCounter`),
  which keeps them bounded relative to event volume.

## Recommended sequencing

1. **P0:** stand up a load test (#1) — you cannot prioritise the rest without it.
2. **P1:** render fleet horizontal scaling (#3), connection pooling (#10),
   retention/partitioning (#2), de-dup index strategy (#4).
3. **P2:** parallelism + query tidy-ups (#5–#9) as they surface in the load test.
