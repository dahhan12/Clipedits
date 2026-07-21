import type { ResourceKind } from "@/generated/prisma";

/** A concrete, resolved thing we can attempt to fetch for a resource link. */
export interface DownloadTarget {
  /** Direct HTTP(S) URL to fetch, when the resource resolves to a plain file. */
  directUrl?: string;
  /** Suggested filename. */
  filename: string;
  kind: ResourceKind;
  /**
   * Set when fetching needs an external extractor (e.g. YouTube via yt-dlp) or
   * a provider API (folder listing). The download service records a clear
   * status instead of pretending to download.
   */
  requiresExtractor?: "youtube" | "gdrive-api" | "dropbox-api";
  note?: string;
}

export interface ResourceResolver {
  readonly kind: ResourceKind;
  resolve(url: string): Promise<DownloadTarget[]>;
}
