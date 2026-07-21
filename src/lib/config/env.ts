import { z } from "zod";

/**
 * Centralized, validated environment access. Import `env` anywhere instead of
 * reading `process.env` directly so misconfiguration fails loudly and secrets
 * have a single well-known home.
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ENCRYPTION_KEY: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("campaignclipper"),
  R2_ENDPOINT: z.string().optional(),

  CONTENT_REWARDS_BASE_URL: z.string().default("https://www.contentrewards.com"),
  CONTENT_REWARDS_DISCOVER_PATH: z.string().default("/discover"),

  WHOP_API_KEY: z.string().optional(),
  WHOP_EXPERIENCE_ID: z.string().optional(),
  WHOP_FORUM_BOT_USERNAME: z.string().default("contentrewardsbot"),

  PLAYWRIGHT_STATE_DIR: z.string().default("./playwright-state"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  DOWNLOAD_ALLOWED_HOSTS: z
    .string()
    .default("drive.google.com,docs.google.com,dropbox.com,www.dropbox.com,youtube.com,www.youtube.com"),
  DOWNLOAD_MAX_BYTES: z
    .string()
    .default("2147483648")
    .transform((v) => Number.parseInt(v, 10)),

  // --- Rendering ---
  // "ffmpeg" (default, robust) or "remotion" (composited overlays via browser).
  RENDER_BACKEND: z.enum(["ffmpeg", "remotion"]).default("ffmpeg"),
  RENDER_WIDTH: z.string().default("1080").transform((v) => Number.parseInt(v, 10)),
  RENDER_HEIGHT: z.string().default("1920").transform((v) => Number.parseInt(v, 10)),
  // Optional chromium path for Remotion (Playwright's is pre-installed here).
  REMOTION_BROWSER_EXECUTABLE: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}

export const env = getEnv();

/** Sandbox mode is on whenever the relevant live credentials are absent. */
export const isSandbox = {
  anthropic: () => !getEnv().ANTHROPIC_API_KEY,
  whopApi: () => !getEnv().WHOP_API_KEY || !getEnv().WHOP_EXPERIENCE_ID,
  r2: () => !getEnv().R2_ENDPOINT || !getEnv().R2_ACCESS_KEY_ID,
};

export function downloadAllowedHosts(): string[] {
  return getEnv()
    .DOWNLOAD_ALLOWED_HOSTS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
