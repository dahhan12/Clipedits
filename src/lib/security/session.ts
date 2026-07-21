import crypto from "node:crypto";
import { env } from "@/lib/config/env";
import type { Role } from "@/generated/prisma";

/**
 * Stateless signed session tokens (HMAC-SHA256 over a JSON payload). Stored in
 * an HttpOnly, Secure, SameSite cookie. Tokens are tamper-evident; the secret
 * (SESSION_SECRET, falling back to ENCRYPTION_KEY) never leaves the server.
 */

export const SESSION_COOKIE = "cc_session";
const MAX_AGE_SEC = 60 * 60 * 12; // 12h

export interface SessionPayload {
  userId: string;
  role: Role;
  workspaceId: string | null;
  exp: number; // unix seconds
}

function secret(): string {
  const s = env.SESSION_SECRET ?? env.ENCRYPTION_KEY;
  if (!s) throw new Error("SESSION_SECRET (or ENCRYPTION_KEY) must be set to sign sessions");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function createSession(input: { userId: string; role: Role; workspaceId: string | null }): string {
  const payload: SessionPayload = {
    userId: input.userId,
    role: input.role,
    workspaceId: input.workspaceId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = fromB64url(sig);
  const b = fromB64url(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extract and verify a session from a request's Cookie header. */
export function sessionFromCookieHeader(cookieHeader: string | null): SessionPayload | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  return verifySession(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)));
}

export const SESSION_MAX_AGE_SEC = MAX_AGE_SEC;
