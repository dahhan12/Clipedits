import type { ResourceKind } from "@/generated/prisma";
import type { DownloadTarget } from "./types";

/**
 * Convert a resource URL into concrete download targets.
 *
 * Share links for Google Drive files and Dropbox files are rewritten into
 * direct-download URLs. Folders and YouTube require a provider API / extractor
 * and are returned flagged (never silently skipped, never faked).
 */

function driveFileId(url: string): string | null {
  const m =
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/) ??
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ??
    url.match(/\/d\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

export function resolveTargets(url: string, kind: ResourceKind): DownloadTarget[] {
  switch (kind) {
    case "DIRECT_VIDEO": {
      const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "video.mp4");
      return [{ directUrl: url, filename, kind }];
    }
    case "GOOGLE_DRIVE_FILE": {
      const id = driveFileId(url);
      if (!id) return [{ filename: "drive-file", kind, requiresExtractor: "gdrive-api", note: "Unrecognized Drive file URL" }];
      return [
        {
          directUrl: `https://drive.google.com/uc?export=download&id=${id}`,
          filename: `${id}.mp4`,
          kind,
        },
      ];
    }
    case "DROPBOX_FILE": {
      // Forcing dl=1 turns a shared preview link into a direct download.
      const direct = url.replace(/([?&])dl=0/, "$1dl=1");
      const withDl = /[?&]dl=/.test(direct) ? direct : `${direct}${direct.includes("?") ? "&" : "?"}dl=1`;
      const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "dropbox.mp4");
      return [{ directUrl: withDl, filename, kind }];
    }
    case "GOOGLE_DRIVE_FOLDER":
      return [{ filename: "drive-folder", kind, requiresExtractor: "gdrive-api", note: "Folder listing needs the Drive API" }];
    case "DROPBOX_FOLDER":
      return [{ filename: "dropbox-folder", kind, requiresExtractor: "dropbox-api", note: "Folder listing needs the Dropbox API" }];
    case "YOUTUBE":
      return [{ filename: "youtube", kind, requiresExtractor: "youtube", note: "Requires yt-dlp and express campaign permission" }];
    default:
      return [{ filename: "resource", kind, note: "Unsupported resource kind for download" }];
  }
}
