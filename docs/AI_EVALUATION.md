# AI Evaluation Harness (campaign parsing)

**Why this exists:** "valid Zod output" is **not** proof that extracted campaign
rules are correct. This harness measures extraction *quality* against a
ground-truth fixture set, with a hard gate on the most dangerous failure —
**critical rules marked confident/compliant while wrong** (a "false PASS").

## What it measures

Run over the versioned fixture set (`src/eval/fixtures.ts`, v1.0.0, 26 labelled
campaigns), the harness computes:

| Metric | Meaning | Threshold |
| --- | --- | --- |
| `fieldPrecision` | of the fields the model populated, how many are correct | ≥ 0.80 |
| `fieldRecall` | of the fields that should be populated, how many the model got | ≥ 0.70 |
| `criticalFieldAccuracy` | correctness on critical fields (status, platforms, deadline, duration, aspect ratio, audio, overlays, mentions, hashtags, max posts, submission) | ≥ 0.90 |
| `contradictionRecall` | of fixtures with a contradiction, how many the model flagged | ≥ 0.90 |
| **`falsePassRate`** | fixtures the model marked confident **yet** a critical field is wrong or a contradiction was missed | **≤ 0.05** |
| `hallucinationCount` | invented values for fields a fixture deliberately omits | 0 |
| `manualReviewRate` | share flagged NEEDS_MANUAL_REVIEW (reported, not gated) | — |

`falsePassRate` is the headline safety metric: a low false-PASS rate means the
system does not silently auto-approve wrong critical rules.

## Fixture set (append-only, versioned)

`src/eval/fixtures.ts` covers the required categories: **clean**, **ambiguous**,
**contradictory**, **missing-field**, **revised**, **pasted-text**, and
**screenshot/PDF-like** documents. Each fixture encodes the ground-truth a
correct extraction should produce, which critical fields are deliberately
omitted (so hallucination is measurable), and whether a contradiction must be
flagged. Bump `EVAL_SET_VERSION` on any change so results stay comparable.

## Running it

```bash
npm run eval                 # prints metrics; fails the process only on a LIVE miss
ANTHROPIC_API_KEY=… npm run eval
```

- **Live** (key present): runs the real parser; exits non-zero if any threshold
  is missed.
- **Sandbox** (no key): runs the fallback extractor and prints metrics for
  visibility, but does **not** fail — the fallback is not a real extraction.

## Regression gate in CI

`tests/eval.test.ts` (always-on) verifies the **scoring engine itself** with
synthetic predictions — perfect prediction → precision/recall 1; a wrong
critical field with confidence → `falsePass=true`; hallucinations counted;
missed contradiction → false pass. This proves the measurement is trustworthy.

`tests/integration/evalLive.itest.ts` runs the **live** thresholds and
self-skips without `ANTHROPIC_API_KEY`. Wire it into staging CI (where the key
lives) so extraction quality regressions fail the build.

## Current status (sandbox baseline)

With no model configured, the fallback extractor yields `fieldRecall = 0`,
`criticalFieldAccuracy = 0`, `manualReviewRate = 1.0`, and — importantly —
`falsePassRate = 0` (it flags everything for review rather than guessing). So the
sandbox is **safe but non-functional**: thresholds are not met, which the harness
reports honestly. A real accuracy number requires a live-model run in staging.

**Launch implication:** automated compliance/publishing must not be trusted until
a live evaluation meets these thresholds — this is a stated launch blocker in
`PRODUCTION_RELEASE_REPORT.md`.
