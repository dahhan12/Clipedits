/**
 * Disaster-recovery verification.
 *
 * Run this against a FRESHLY-RESTORED database (and, optionally, the restored
 * object store) to prove the restore is usable before cutting traffic over. It
 * is a smoke check, not a data-integrity audit: it verifies connectivity, that
 * every migration is applied, that a read/write round-trip works, and that core
 * tables are queryable. It never mutates real data beyond a self-cleaning canary
 * row.
 *
 * Usage:  DATABASE_URL=... npm run dr:verify
 * Exit 0 = all checks passed; exit 1 = at least one check failed.
 */
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { PrismaClient } from "../src/generated/prisma";
import { objectStore } from "../src/adapters/storage/objectStore";

interface Check {
  name: string;
  run: () => Promise<string>; // returns a detail string on success, throws on failure
}

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function main() {
  const checks: Check[] = [
    {
      name: "database connectivity",
      run: async () => {
        await prisma.$queryRaw`SELECT 1`;
        return "SELECT 1 ok";
      },
    },
    {
      name: "migrations applied",
      run: async () => {
        // `migrate status` exits non-zero if migrations are pending/failed.
        const out = execFileSync("npx", ["prisma", "migrate", "status"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (/have not yet been applied|failed migrations|drift/i.test(out)) {
          throw new Error("pending/failed migrations detected");
        }
        return "schema in sync";
      },
    },
    {
      name: "core tables queryable",
      run: async () => {
        const [campaigns, clips, publications, jobRuns] = await Promise.all([
          prisma.campaign.count(),
          prisma.renderedClip.count(),
          prisma.publication.count(),
          prisma.jobRun.count(),
        ]);
        return `campaigns=${campaigns} clips=${clips} publications=${publications} jobRuns=${jobRuns}`;
      },
    },
    {
      name: "read/write round-trip (canary)",
      run: async () => {
        const key = `dr-verify.canary`;
        const stamp = new Date().toISOString();
        await prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: stamp, updatedBy: "dr-verify" },
          update: { value: stamp, updatedBy: "dr-verify" },
        });
        const back = await prisma.systemSetting.findUnique({ where: { key } });
        if (back?.value !== stamp) throw new Error("canary read did not match write");
        await prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
        return "write→read→delete ok";
      },
    },
    {
      name: "object store round-trip (canary)",
      run: async () => {
        // Prove the store is reachable and read-consistent: write a small canary
        // to a fixed key (overwritten each run) and read it back.
        const store = objectStore();
        const key = "dr-verify/canary.txt";
        const stamp = new Date().toISOString();
        await store.putStream(key, Readable.from([Buffer.from(stamp)]), "text/plain");
        const chunks: Buffer[] = [];
        for await (const chunk of await store.getStream(key)) chunks.push(Buffer.from(chunk));
        const readBack = Buffer.concat(chunks).toString("utf8");
        if (readBack !== stamp) throw new Error("canary read did not match write");
        return `${store.mode} store write→read ok`;
      },
    },
  ];

  for (const c of checks) {
    try {
      const detail = await c.run();
      results.push({ name: c.name, ok: true, detail });
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${c.name} — ${detail}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ name: c.name, ok: false, detail });
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${c.name} — ${detail}`);
    }
  }

  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\nDR verification: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("dr-verify crashed:", err);
  process.exit(1);
});
