import type { Platform, PublicationMode } from "@/generated/prisma";

export class MissingCredentials extends Error {}

export interface PublishInput {
  /** Local path to the rendered MP4 to upload. */
  localPath: string;
  /** Public URL of the clip, when the provider ingests by URL rather than upload. */
  clipUrl?: string;
  caption: string;
  mode: PublicationMode;
  /** Decrypted access token for the connected account (never logged). */
  accessToken?: string;
  accountHandle: string;
}

export interface PublishResult {
  status: "DRAFTED" | "PUBLISHED" | "PENDING";
  externalPostId?: string;
  postUrl?: string;
  note?: string;
}

/**
 * A publishing provider. Real official APIs are used when credentials are
 * present; without them the provider prepares a local DRAFT (never fakes a live
 * post, never uses browser automation to imitate posting).
 */
export interface PublishProvider {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PublishResult>;
}
