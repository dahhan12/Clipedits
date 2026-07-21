import crypto from "node:crypto";
import { env } from "@/lib/config/env";

/**
 * Envelope encryption for secrets at rest (OAuth refresh tokens), with key
 * versioning so keys can be ROTATED without losing access to old data.
 *
 * Ciphertext format (versioned):  `cc1:<keyId>:<base64(iv|tag|ct)>`
 *   - keyId identifies which key encrypted the value; retired keys remain
 *     available for decryption via ENCRYPTION_KEYS_RETIRED.
 *   - keyId is bound as GCM AAD, so tampering with the header fails auth.
 *   - legacy values (no `cc1:` prefix) decrypt with ENCRYPTION_KEY for backward
 *     compatibility, then get upgraded on the next rotation pass.
 *
 * The `KeyProvider` abstraction lets this later source keys from a managed KMS
 * without touching call sites.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "cc1";

export interface KeyProvider {
  current(): { id: string; key: Buffer };
  byId(id: string): Buffer | null;
}

function decodeKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${label} must decode to exactly 32 bytes`);
  return key;
}

/** Default provider backed by env vars. Swap for a KMS-backed provider later. */
export class EnvKeyProvider implements KeyProvider {
  private retired(): Record<string, string> {
    if (!env.ENCRYPTION_KEYS_RETIRED) return {};
    try {
      return JSON.parse(env.ENCRYPTION_KEYS_RETIRED) as Record<string, string>;
    } catch {
      throw new Error("ENCRYPTION_KEYS_RETIRED must be JSON {id: base64key}");
    }
  }
  current(): { id: string; key: Buffer } {
    if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
    return { id: env.ENCRYPTION_KEY_ID, key: decodeKey(env.ENCRYPTION_KEY, "ENCRYPTION_KEY") };
  }
  byId(id: string): Buffer | null {
    if (id === env.ENCRYPTION_KEY_ID && env.ENCRYPTION_KEY) return decodeKey(env.ENCRYPTION_KEY, "ENCRYPTION_KEY");
    const retired = this.retired()[id];
    return retired ? decodeKey(retired, `retired key ${id}`) : null;
  }
}

let provider: KeyProvider = new EnvKeyProvider();
/** Override the key provider (tests / future KMS). */
export function setKeyProvider(p: KeyProvider): void {
  provider = p;
}

/** Encrypt with the CURRENT key, embedding its id (versioned format). */
export function encrypt(plaintext: string): string {
  const { id, key } = provider.current();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(`${PREFIX}:${id}`, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, enc]).toString("base64");
  return `${PREFIX}:${id}:${body}`;
}

/** Decrypt a versioned or legacy ciphertext. */
export function decrypt(payload: string): string {
  if (payload.startsWith(`${PREFIX}:`)) {
    const [, id, body] = payload.split(":");
    if (!id || !body) throw new Error("Malformed ciphertext header");
    const key = provider.byId(id);
    if (!key) throw new Error(`No key available for id ${id} (rotate/retire config?)`);
    const buf = Buffer.from(body, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAAD(Buffer.from(`${PREFIX}:${id}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }
  // Legacy (unversioned) [iv|tag|ct] base64 encrypted with ENCRYPTION_KEY.
  const { key } = provider.current();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** True when a ciphertext is not encrypted under the current key (needs rewrap). */
export function needsRewrap(payload: string): boolean {
  const { id } = provider.current();
  if (!payload.startsWith(`${PREFIX}:`)) return true; // legacy
  const parts = payload.split(":");
  return parts[1] !== id;
}
