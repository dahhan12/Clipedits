import crypto from "node:crypto";
import { encrypt, decrypt } from "@/lib/security/envelope";

/**
 * Secret encryption at rest (OAuth refresh tokens). Delegates to the versioned
 * envelope so keys can be rotated (see envelope.ts + docs/SECRET_ROTATION.md).
 * Plaintext is never persisted or logged.
 */

export function encryptSecret(plaintext: string): string {
  return encrypt(plaintext);
}

export function decryptSecret(payload: string): string {
  return decrypt(payload);
}

/** Stable content hash used for page-revision and asset-checksum keys. */
export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Hash a password with scrypt; returns `salt:hash` (both hex). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify a password against a `salt:hash` string in constant time. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
