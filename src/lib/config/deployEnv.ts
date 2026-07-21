import { getEnv } from "./env";

/**
 * Deployment-tier guards. Keeps production credentials out of local/CI, and
 * ensures public social posting can only ever happen in staging/production —
 * never accidentally from a developer machine or CI.
 */

export type AppEnv = "local" | "ci" | "staging" | "production";

export function appEnv(): AppEnv {
  return getEnv().APP_ENV;
}

export function isProdLikeEnv(e: AppEnv): boolean {
  return e === "staging" || e === "production";
}

export function isProdLike(): boolean {
  return isProdLikeEnv(appEnv());
}

/** Public (AUTO/DIRECT) posting is only permitted in staging/production. */
export function publicPostingAllowedByEnv(): boolean {
  return isProdLike();
}

export class DeploymentConfigError extends Error {}

export interface DeployConfig {
  appEnv: AppEnv;
  encryptionKey?: string;
  sessionSecret?: string;
  databaseUrl?: string;
  tiktokAudited: boolean;
  instagramApproved: boolean;
  youtubeVerified: boolean;
}

/** Pure validation core: returns a list of problems ([] means OK). */
export function checkDeployment(cfg: DeployConfig): string[] {
  const problems: string[] = [];
  const e = cfg.appEnv;

  if (isProdLikeEnv(e)) {
    if (!cfg.encryptionKey) problems.push("ENCRYPTION_KEY is required");
    if (!(cfg.sessionSecret ?? cfg.encryptionKey)) problems.push("SESSION_SECRET is required");
    if (!cfg.databaseUrl) problems.push("DATABASE_URL is required");
  }

  if (e === "local" || e === "ci") {
    const markers = [
      ["TIKTOK_AUDITED", cfg.tiktokAudited],
      ["INSTAGRAM_APPROVED", cfg.instagramApproved],
      ["YOUTUBE_API_VERIFIED", cfg.youtubeVerified],
    ]
      .filter(([, v]) => v === true)
      .map(([k]) => k as string);
    if (markers.length) {
      problems.push(`must not set production publishing approvals in ${e}: ${markers.join(", ")}`);
    }
    if ((cfg.databaseUrl ?? "").toLowerCase().includes("prod")) {
      problems.push(`DATABASE_URL looks like a production database in ${e}`);
    }
  }

  return problems;
}

/**
 * Validate the environment for the current deployment tier. Call at process
 * startup (web instrumentation + workers). Throws on an unsafe combination.
 */
export function validateDeploymentEnv(): void {
  const env = getEnv();
  const problems = checkDeployment({
    appEnv: env.APP_ENV,
    encryptionKey: env.ENCRYPTION_KEY,
    sessionSecret: env.SESSION_SECRET,
    databaseUrl: env.DATABASE_URL,
    tiktokAudited: env.TIKTOK_AUDITED,
    instagramApproved: env.INSTAGRAM_APPROVED,
    youtubeVerified: env.YOUTUBE_API_VERIFIED,
  });
  if (problems.length) {
    throw new DeploymentConfigError(`Unsafe deployment config (APP_ENV=${env.APP_ENV}): ${problems.join("; ")}`);
  }
}
