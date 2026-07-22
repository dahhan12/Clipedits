# Live Verification Runbook

How to move each provider on the **/providers** board from red → `LIVE_VERIFIED`.
The board is honest by construction: a provider only shows `LIVE_VERIFIED` after
`npm run verify:live` (or an operator's explicit `--record`) has stored a real
passing check. Credential presence alone never counts as verified.

```
npm run verify:live                          # run all auto checks, record results
npm run verify:live -- --record <key> "..."  # manually record a pass (approval-gated / scrapers)
npm run verify:live -- --unrecord <key>      # clear a record (re-verify from scratch)
```

`<key>` values: `anthropic`, `whisper`, `r2`, `whop-api`, `content-rewards`,
`submission`, `tiktok`, `instagram`, `youtube`, `metrics`.

Prerequisite: a reachable database (the records live in `SystemSetting`).

---

## Tier 1 — auto-verifiable from credentials (do these first)

These run a real smoke check and record the result automatically.

### `anthropic` — **highest priority**
1. Set `ANTHROPIC_API_KEY` in the environment.
2. `npm run verify:live` → forces a real structured tool call and records the pass.
3. **Then run the accuracy gate:** `npm run eval`. This is the one that matters —
   it measures `falsePassRate` / `criticalFieldAccuracy` against the fixtures. A
   passing tool call proves connectivity; the eval proves the extraction can be
   *trusted* by compliance. Record the eval report in `AI_EVALUATION.md`.
   *(Closes technical-debt P0-3.)*

### `r2` — object storage
1. Set `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
2. `npm run verify:live` → does a real put→read round-trip against the bucket.

### `whisper` — transcription
1. Set `WHISPER_API_URL`, `WHISPER_API_KEY` (and `WHISPER_MODEL` if non-default).
2. `npm run verify:live` → generates a 1s sample (needs ffmpeg) and posts it.

### `whop-api` — Whop discovery
1. Set `WHOP_API_KEY`, `WHOP_EXPERIENCE_ID`.
2. `npm run verify:live` → runs real discovery and records the campaign count.
   If it fails, the endpoint shape has drifted — see the adapter and re-check
   against Whop's current API docs.

---

## Tier 2 — live-site scrapers (verify against the real page, then record)

`content-rewards` (discovery) and `submission` (form-fill) use authenticated
Playwright automation. Their DOM selectors have **never been run against the
live site**, so they cannot be auto-verified and are intentionally *not*
selector-edited blind (that would risk breaking an untested path). To verify:

1. Provide an authenticated browser session: set `PLAYWRIGHT_STATE_DIR` and log
   in once so cookies/storage persist (never store raw passwords).
2. Run discovery against the real site and confirm it returns real campaigns:
   `npm run worker:discovery` (watch the logs) or drive `runDiscovery` directly.
3. If selectors are stale, fix them in `src/adapters/discovery/contentRewards.ts`
   / `whopForum.ts` / `src/adapters/submission/contentRewards.ts` against the
   live DOM, add a regression note, and re-run.
4. Once a real discovery/submission round-trips, record it:
   `npm run verify:live -- --record content-rewards "discovered N real campaigns on <date>"`.

> **Operational note (tech-debt P1-5):** scraping is fragile and ToS-sensitive.
> Treat selector breakage as a monitored, first-class failure; prefer an
> official/partner API wherever one exists.

---

## Tier 3 — publishing (blocked by platform approval)

`tiktok`, `instagram`, `youtube` cannot reach `LIVE_VERIFIED` from credentials —
they require the platform's app review. These are the long pole; start them in
parallel with Tier 1.

### TikTok
1. Create a TikTok developer app; request **Content Posting API** + audit for
   direct-post (unaudited apps are limited to inbox/DRAFT + `SELF_ONLY`).
2. Set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`; connect an account (OAuth).
3. After a **real** post succeeds end-to-end, record it:
   `npm run verify:live -- --record tiktok "direct-posted video <id> on <date>"`.

### Instagram Reels
1. Facebook/Instagram app with **`instagram_content_publish`**; a Business/Creator
   account; a publicly reachable `video_url`.
2. Set `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`; connect the account.
3. After a real Reel publishes, `--record instagram "published reel <id>"`.

### YouTube Shorts
1. Google Cloud project with **YouTube Data API v3**; OAuth consent verified
   (unverified projects can only create `private` uploads).
2. Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`; connect the channel.
3. After a real public upload, `--record youtube "uploaded short <id>"`.

Until a platform is approved **and** verified, capability gating keeps the
system in DRAFT — it will not claim to have posted.

---

## Tier 4 — metrics

`metrics` needs a real published post to read stats from. After Tier 3 for at
least one platform, confirm real numbers flow (YouTube stats are implemented;
TikTok/IG return `unknown` until their analytics scopes are granted), then
`--record metrics "read real stats for post <id>"`.

---

## What "done" looks like

- The /providers board shows `LIVE_VERIFIED` (green) for every provider you rely
  on, each with a `lastVerifiedAt` timestamp.
- `RELEASE_v1.0.0-alpha.md` §5 "Verified integrations" updated to list them.
- The release-checklist items "at least one integration LIVE_VERIFIED", "platform
  approvals", and "LIVE eval recorded" are checked.
- Re-run `npm run verify:live` on a schedule (or in CI against staging) so a
  provider that silently breaks flips back off `LIVE_VERIFIED`.
