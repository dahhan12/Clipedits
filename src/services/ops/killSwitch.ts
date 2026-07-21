import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { logger } from "@/lib/logging/logger";

/**
 * Global kill switches + runtime settings, backed by the SystemSetting table so
 * an admin can halt spendy work without a redeploy. Reads are cached for a short
 * TTL to avoid a DB hit on every job; writes clear the cache immediately.
 *
 * Fail-safe direction: if the settings store is unreachable, `isHalted` returns
 * FALSE (do not wedge the whole pipeline on a transient DB blip) but `getCapUsd`
 * is only ever additive protection, so a read failure there also fails open. The
 * authoritative safety gates (compliance, rights, capability) are unaffected.
 */

export type HaltArea = "publishing" | "rendering" | "ai";

const HALT_KEYS: Record<HaltArea, string> = {
  publishing: "killswitch.publishing",
  rendering: "killswitch.rendering",
  ai: "killswitch.ai",
};

const GLOBAL_DAILY_CAP_KEY = "cost.globalDailyCapUsd";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: string | null; at: number }>();

async function readSetting(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const value = row?.value ?? null;
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    logger.warn({ err, key }, "readSetting failed; failing open");
    return null;
  }
}

async function writeSetting(key: string, value: string, updatedBy?: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, updatedBy },
    update: { value, updatedBy },
  });
  cache.set(key, { value, at: Date.now() });
}

/** True when work in `area` is currently halted by an admin kill switch. */
export async function isHalted(area: HaltArea): Promise<boolean> {
  return (await readSetting(HALT_KEYS[area])) === "true";
}

export async function setHalted(area: HaltArea, halted: boolean, updatedBy?: string): Promise<void> {
  await writeSetting(HALT_KEYS[area], halted ? "true" : "false", updatedBy);
  await audit({
    action: halted ? "killswitch.engaged" : "killswitch.released",
    entityType: "SystemSetting",
    entityId: HALT_KEYS[area],
    actor: updatedBy,
    metadata: { area },
  });
  logger.warn({ area, halted, updatedBy }, "kill switch toggled");
}

/** Global daily cost cap (USD), or null if unset. */
export async function getGlobalDailyCapUsd(): Promise<number | null> {
  const raw = await readSetting(GLOBAL_DAILY_CAP_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function setGlobalDailyCapUsd(capUsd: number | null, updatedBy?: string): Promise<void> {
  await writeSetting(GLOBAL_DAILY_CAP_KEY, capUsd == null ? "" : String(capUsd), updatedBy);
  await audit({
    action: "cost.globalCap.set",
    entityType: "SystemSetting",
    entityId: GLOBAL_DAILY_CAP_KEY,
    actor: updatedBy,
    metadata: { capUsd },
  });
}

export interface KillSwitchState {
  publishing: boolean;
  rendering: boolean;
  ai: boolean;
  globalDailyCapUsd: number | null;
}

export async function getKillSwitchState(): Promise<KillSwitchState> {
  const [publishing, rendering, ai, globalDailyCapUsd] = await Promise.all([
    isHalted("publishing"),
    isHalted("rendering"),
    isHalted("ai"),
    getGlobalDailyCapUsd(),
  ]);
  return { publishing, rendering, ai, globalDailyCapUsd };
}

/** Test/maintenance hook: clear the read-through cache. */
export function _clearSettingCache(): void {
  cache.clear();
}
