/**
 * Live provider verification.
 *
 * Runs a REAL smoke check against each credential-gated provider that is
 * configured, and records the outcome (verification.ts → SystemSetting). The
 * readiness board (/providers) then advances a provider to LIVE_VERIFIED — but
 * only for a check that actually passed. Nothing here fabricates success; a
 * provider with missing credentials is skipped, not marked verified.
 *
 * Usage:
 *   npm run verify:live                     # run all auto checks
 *   npm run verify:live -- --record <key> "detail"   # manually record a pass
 *   npm run verify:live -- --unrecord <key>          # clear a record
 *
 * Manual record exists for providers that cannot be auto-verified from
 * credentials alone (platform-approval publishing, live-site scrapers): after a
 * real end-to-end test (e.g. a genuine TikTok post), an operator records it.
 * See docs/LIVE_VERIFICATION.md.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { prisma } from "../src/lib/db/prisma";
import { isSandbox } from "../src/lib/config/env";
import { recordVerification } from "../src/lib/providers/verification";
import { extractStructured } from "../src/lib/ai/anthropic";
import { objectStore } from "../src/adapters/storage/objectStore";
import { WhopForumAdapter } from "../src/adapters/discovery/whopForum";
import { WhisperTranscriber } from "../src/adapters/transcription/whisper";
import { runMedia, FfmpegUnavailable } from "../src/lib/media/ffmpeg";

interface AutoCheck {
  key: string;
  name: string;
  /** True when credentials are present (else the check is skipped). */
  configured: () => boolean;
  run: () => Promise<string>; // returns a detail string on success, throws on failure
}

const CHECKS: AutoCheck[] = [
  {
    key: "anthropic",
    name: "Anthropic (parse/score/vision)",
    configured: () => !isSandbox.anthropic(),
    run: async () => {
      const out = await extractStructured({
        system: "You extract a single numeric field exactly as instructed.",
        prompt: "Put the number 42 in the 'answer' field.",
        toolName: "echo_number",
        toolDescription: "Return a single number.",
        inputSchema: {
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
        },
        sandboxFallback: { answer: 0 },
        maxTokens: 64,
      });
      const answer = (out as { answer?: unknown }).answer;
      if (typeof answer !== "number") throw new Error(`tool call did not return a number (got ${typeof answer})`);
      return `structured tool call returned answer=${answer}`;
    },
  },
  {
    key: "r2",
    name: "Cloudflare R2 storage",
    configured: () => !isSandbox.r2(),
    run: async () => {
      const store = objectStore();
      if (store.mode !== "r2") throw new Error("object store is in local mode (R2 not configured)");
      const key = "verify-live/canary.txt";
      const stamp = new Date().toISOString();
      await store.putStream(key, Readable.from([Buffer.from(stamp)]), "text/plain");
      const chunks: Buffer[] = [];
      for await (const chunk of await store.getStream(key)) chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).toString("utf8") !== stamp) throw new Error("canary read did not match write");
      return "R2 put→read round-trip ok";
    },
  },
  {
    key: "whisper",
    name: "Transcription (Whisper)",
    configured: () => !isSandbox.whisper(),
    run: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "cc-verify-whisper-"));
      const wav = path.join(dir, "silence.wav");
      try {
        // A short silent clip is enough to prove the endpoint accepts + responds.
        await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", wav]).catch(
          (err) => {
            if (err instanceof FfmpegUnavailable) throw new Error("ffmpeg unavailable to generate a sample");
            throw err;
          },
        );
        const t = await new WhisperTranscriber().transcribe({ path: wav, durationSec: 1 });
        return `Whisper responded (provider=${t.provider}, ${t.segments.length} segments)`;
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  },
  {
    key: "whop-api",
    name: "Whop Forums API",
    configured: () => !isSandbox.whopApi(),
    run: async () => {
      const found = await new WhopForumAdapter().discover();
      return `Whop discovery returned ${found.length} campaign(s)`;
    },
  },
];

/** Providers that cannot be auto-verified from credentials alone. */
const MANUAL_ONLY = [
  "content-rewards (live-site scraper — verify selectors against the real page)",
  "submission (live-site form-fill — verify against a real campaign)",
  "tiktok, instagram, youtube (publishing — need platform approval + a real post)",
  "metrics (needs a real published post to read stats from)",
];

async function runAuto(): Promise<number> {
  let failures = 0;
  for (const c of CHECKS) {
    if (!c.configured()) {
      // eslint-disable-next-line no-console
      console.log(`  ○ ${c.name} — skipped (credentials not configured)`);
      continue;
    }
    try {
      const detail = await c.run();
      await recordVerification(c.key, { ok: true, detail, at: new Date().toISOString() });
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${c.name} — ${detail}`);
    } catch (err) {
      failures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      await recordVerification(c.key, { ok: false, detail, at: new Date().toISOString() });
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${c.name} — ${detail}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\nManual verification (record after a real end-to-end test):`);
  for (const m of MANUAL_ONLY) console.log(`  · ${m}`); // eslint-disable-line no-console
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--record") {
    const key = args[1];
    const detail = args.slice(2).join(" ") || "manually verified";
    if (!key) throw new Error("usage: --record <providerKey> \"detail\"");
    await recordVerification(key, { ok: true, detail, at: new Date().toISOString() });
    // eslint-disable-next-line no-console
    console.log(`Recorded ${key} as LIVE_VERIFIED: ${detail}`);
  } else if (args[0] === "--unrecord") {
    const key = args[1];
    if (!key) throw new Error("usage: --unrecord <providerKey>");
    await prisma.systemSetting.deleteMany({ where: { key: `verify.${key}` } });
    // eslint-disable-next-line no-console
    console.log(`Cleared verification record for ${key}`);
  } else {
    // eslint-disable-next-line no-console
    console.log("Running live provider checks…\n");
    const failures = await runAuto();
    await prisma.$disconnect();
    if (failures > 0) process.exit(1);
    return;
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("verify:live crashed:", err);
  process.exit(1);
});
