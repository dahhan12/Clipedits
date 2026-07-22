import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

/**
 * Live-verification records. `npm run verify:live` runs a real smoke check
 * against each configured provider and stores the outcome here (in
 * SystemSetting, keyed `verify.<providerKey>`). The readiness board reads these
 * and upgrades a provider to LIVE_VERIFIED ONLY when a real check actually
 * passed — never on credential presence alone. This keeps the board honest:
 * "verified" means "we called the real thing and it worked", nothing weaker.
 */

export interface VerificationRecord {
  ok: boolean;
  detail: string;
  /** ISO timestamp of the check. */
  at: string;
}

const PREFIX = "verify.";

export async function recordVerification(providerKey: string, rec: VerificationRecord): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: PREFIX + providerKey },
    create: { key: PREFIX + providerKey, value: JSON.stringify(rec), updatedBy: "verify:live" },
    update: { value: JSON.stringify(rec), updatedBy: "verify:live" },
  });
}

/** All stored verification records, keyed by provider key (prefix stripped). */
export async function getVerifications(): Promise<Record<string, VerificationRecord>> {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    const out: Record<string, VerificationRecord> = {};
    for (const r of rows) {
      try {
        out[r.key.slice(PREFIX.length)] = JSON.parse(r.value) as VerificationRecord;
      } catch {
        // Ignore a malformed record rather than break the whole board.
      }
    }
    return out;
  } catch (err) {
    logger.warn({ err }, "getVerifications failed; board shows unverified");
    return {};
  }
}
