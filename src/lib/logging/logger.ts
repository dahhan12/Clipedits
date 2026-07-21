import pino from "pino";
import { env } from "@/lib/config/env";

/**
 * Structured logger with secret redaction. Anything matching a sensitive key
 * name is replaced with `[REDACTED]` before it is ever written.
 */

const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "encryptedRefreshToken",
  "*.encryptedRefreshToken",
  "authorization",
  "*.authorization",
  "apiKey",
  "*.apiKey",
  "ANTHROPIC_API_KEY",
  "WHOP_API_KEY",
  "ENCRYPTION_KEY",
  "R2_SECRET_ACCESS_KEY",
  "cookie",
  "*.cookie",
];

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { app: "campaignclipper" },
});

export type Logger = typeof logger;
