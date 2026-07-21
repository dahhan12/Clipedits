import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

/**
 * Object storage abstraction over Cloudflare R2 (S3-compatible).
 *
 * In sandbox mode (no R2 endpoint/keys configured) objects are written to a
 * local, git-ignored `storage/` directory so the pipeline is fully exercisable
 * offline. The interface and the returned storage keys are identical in both
 * modes, so nothing downstream needs to know which backend is active.
 */

const LOCAL_ROOT = resolve(process.cwd(), "storage");

export class UnsafeStorageKeyError extends Error {}

/**
 * Reject storage keys that could traverse outside the bucket/root
 * (`..`, absolute paths, backslashes, NUL). Keys are app-generated, but this is
 * defence-in-depth against any value that flows in from parsed content.
 */
export function assertSafeKey(key: string): string {
  if (!key || key.length > 1024) throw new UnsafeStorageKeyError("empty or over-long key");
  if (key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new UnsafeStorageKeyError(`unsafe key: ${key}`);
  }
  if (key.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new UnsafeStorageKeyError(`path traversal in key: ${key}`);
  }
  return key;
}

export interface ObjectStore {
  readonly mode: "r2" | "local";
  putStream(key: string, body: Readable, contentType?: string): Promise<{ key: string }>;
  getStream(key: string): Promise<Readable>;
  /** Absolute local path for a key, when the pipeline needs a real file (ffmpeg). */
  localPathFor(key: string): string;
  /**
   * A time-limited signed URL for direct download, or null when the backend has
   * no signing (local sandbox) and the caller should stream via the app route.
   */
  signedDownloadUrl(key: string, expiresSec?: number): Promise<string | null>;
  /** A time-limited signed URL for direct upload (PUT), or null when unsupported. */
  signedUploadUrl(key: string, contentType?: string, expiresSec?: number): Promise<string | null>;
}

class LocalObjectStore implements ObjectStore {
  readonly mode = "local" as const;
  localPathFor(key: string): string {
    return join(LOCAL_ROOT, assertSafeKey(key));
  }
  async putStream(key: string, body: Readable): Promise<{ key: string }> {
    const path = this.localPathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(body, createWriteStream(path));
    return { key };
  }
  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.localPathFor(key));
  }
  async signedDownloadUrl(): Promise<string | null> {
    return null; // no signing locally; caller streams via the app route
  }
  async signedUploadUrl(): Promise<string | null> {
    return null;
  }
}

class R2ObjectStore implements ObjectStore {
  readonly mode = "r2" as const;
  private client: S3Client;
  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  // Even with R2 active, ffmpeg needs a real local file; callers stage via getStream.
  localPathFor(key: string): string {
    return join(LOCAL_ROOT, "cache", assertSafeKey(key));
  }
  async putStream(key: string, body: Readable, contentType?: string): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: assertSafeKey(key), Body: body, ContentType: contentType }),
    );
    return { key };
  }
  async getStream(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: assertSafeKey(key) }));
    return out.Body as Readable;
  }
  async signedDownloadUrl(key: string, expiresSec = 300): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: assertSafeKey(key) }), { expiresIn: expiresSec });
  }
  async signedUploadUrl(key: string, contentType?: string, expiresSec = 300): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: assertSafeKey(key), ContentType: contentType }),
      { expiresIn: expiresSec },
    );
  }
}

let store: ObjectStore | null = null;

export function objectStore(): ObjectStore {
  if (!store) {
    store = isSandbox.r2() ? new LocalObjectStore() : new R2ObjectStore();
    logger.info({ mode: store.mode }, "Object store initialized");
  }
  return store;
}

/** Ensure a stored object exists as a local file (staging from R2 if needed). */
export async function ensureLocalFile(key: string): Promise<string> {
  const s = objectStore();
  const path = s.localPathFor(key);
  if (s.mode === "local") return path;
  try {
    await stat(path);
    return path;
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await pipeline(await s.getStream(key), createWriteStream(path));
    return path;
  }
}
