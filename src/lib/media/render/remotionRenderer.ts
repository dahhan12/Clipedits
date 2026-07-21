import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { renderClip9x16 } from "@/lib/media/ffmpeg";
import type { OverlayRenderer, RenderPlan } from "./types";

const FPS = 30;

/**
 * Remotion render backend. Produces a normalized 9:16 base clip with FFmpeg,
 * then composites campaign-permitted overlays over it using the Remotion `Clip`
 * composition (real browser render). Remotion packages are imported dynamically
 * so the Next build never bundles them; callers fall back to FFmpeg on failure.
 */
export class RemotionRenderer implements OverlayRenderer {
  readonly backend = "remotion" as const;

  async render(plan: RenderPlan): Promise<void> {
    const workDir = await mkdtemp(path.join(tmpdir(), "cc-remotion-"));
    const publicDir = path.join(workDir, "public");
    const baseName = "base.mp4";
    const basePath = path.join(publicDir, baseName);

    try {
      // 1. Base clip (no overlays) that Remotion will composite over.
      await renderClip9x16({
        inputPath: plan.inputPath,
        outputPath: basePath,
        startSec: plan.startSec,
        endSec: plan.endSec,
        width: plan.width,
        height: plan.height,
      });

      // 2. Composite overlays via Remotion (dynamic import).
      const { bundle } = await import("@remotion/bundler");
      const { renderMedia, selectComposition } = await import("@remotion/renderer");

      const durationInFrames = Math.max(1, Math.round((plan.endSec - plan.startSec) * FPS));
      const inputProps = {
        videoSrc: baseName,
        overlays: plan.overlays,
        logoText: plan.logoText,
        durationInFrames,
        width: plan.width,
        height: plan.height,
      };

      const serveUrl = await bundle({
        entryPoint: path.resolve(process.cwd(), "src/remotion/index.ts"),
        publicDir,
      });

      const composition = await selectComposition({ serveUrl, id: "Clip", inputProps });

      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        audioCodec: "aac",
        outputLocation: plan.outputPath,
        inputProps,
        browserExecutable: env.REMOTION_BROWSER_EXECUTABLE,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch((err) =>
        logger.warn({ err }, "Failed to clean Remotion work dir"),
      );
    }
  }
}
