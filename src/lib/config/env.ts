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
  // Identifier for the CURRENT encryption key (bump on rotation, e.g. "1"→"2").
  ENCRYPTION_KEY_ID: z.string().default("1"),
  // Retired keys still needed to DECRYPT old data, as JSON {"<id>":"<base64>"}.
  ENCRYPTION_KEYS_RETIRED: z.string().optional(),
  // HMAC secret for signing session cookies. Falls back to ENCRYPTION_KEY.
  SESSION_SECRET: z.string().optional(),
  // Per-IP request budget per minute for mutating API routes.
  RATE_LIMIT_PER_MINUTE: z.string().default("120").transform((v) => Number.parseInt(v, 10)),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  // Whisper-compatible transcription (OpenAI-style /audio/transcriptions).
  WHISPER_API_URL: z.string().optional(),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default("whisper-1"),

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
  // Trim leading/trailing silence during render (may shorten duration).
  RENDER_TRIM_SILENCE: z.string().default("false").transform((v) => v === "true"),
  // Optional chromium path for Remotion (Playwright's is pre-installed here).
  REMOTION_BROWSER_EXECUTABLE: z.string().optional(),

  // --- Publishing OAuth (client credentials only; user tokens live encrypted
  // in the DB, never in env or logs) ---
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  // Real provider approval/audit status. Default false — the app must NOT claim
  // public posting until these are explicitly set after passing provider review.
  TIKTOK_AUDITED: z.string().default("false").transform((v) => v === "true"),
  INSTAGRAM_APPROVED: z.string().default("false").transform((v) => v === "true"),
  YOUTUBE_API_VERIFIED: z.string().default("false").transform((v) => v === "true"),

  // --- Submission ---
  // When true, the final Playwright submission step still requires an explicit
  // confirmation before it submits (MVP safety). Keep true during the MVP.
  SUBMISSION_REQUIRE_CONFIRMATION: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
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
  tiktok: () => !getEnv().TIKTOK_CLIENT_KEY || !getEnv().TIKTOK_CLIENT_SECRET,
  instagram: () => !getEnv().INSTAGRAM_APP_ID || !getEnv().INSTAGRAM_APP_SECRET,
  youtube: () => !getEnv().YOUTUBE_CLIENT_ID || !getEnv().YOUTUBE_CLIENT_SECRET,
  whisper: () => !getEnv().WHISPER_API_URL || !getEnv().WHISPER_API_KEY,
};

export function downloadAllowedHosts(): string[] {
  return getEnv()
    .DOWNLOAD_ALLOWED_HOSTS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
