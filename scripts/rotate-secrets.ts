/**
 * Re-encrypt (rewrap) all secrets at rest under the CURRENT encryption key.
 *
 * Run AFTER setting the new key as ENCRYPTION_KEY / ENCRYPTION_KEY_ID and moving
 * the previous key into ENCRYPTION_KEYS_RETIRED. Idempotent: values already under
 * the current key are skipped. Never logs plaintext or key material.
 *
 *   npm run rotate:secrets            # rewrap
 *   npm run rotate:secrets -- --dry   # report only
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { needsRewrap } from "@/lib/security/envelope";

async function main() {
  const dry = process.argv.includes("--dry");
  const accounts = await prisma.socialAccount.findMany({
    where: { encryptedRefreshToken: { not: null } },
    select: { id: true, encryptedRefreshToken: true },
  });

  let rewrapped = 0;
  let skipped = 0;
  let failed = 0;
  for (const a of accounts) {
    const ct = a.encryptedRefreshToken!;
    if (!needsRewrap(ct)) {
      skipped += 1;
      continue;
    }
    try {
      const plaintext = decryptSecret(ct);
      if (!dry) {
        await prisma.socialAccount.update({ where: { id: a.id }, data: { encryptedRefreshToken: encryptSecret(plaintext) } });
      }
      rewrapped += 1;
    } catch {
      failed += 1;
      console.error(`FAILED to rewrap account ${a.id} (missing retired key?)`);
    }
  }

  console.log(`Secret rotation ${dry ? "(dry run) " : ""}complete: rewrapped=${rewrapped} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
