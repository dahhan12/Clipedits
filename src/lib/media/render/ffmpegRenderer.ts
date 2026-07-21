import { renderClip9x16 } from "@/lib/media/ffmpeg";
import type { OverlayRenderer, RenderPlan } from "./types";

/**
 * FFmpeg render backend: trims, scales/crops to the target frame, burns in any
 * permitted overlay text, and encodes H.264/AAC in a single pass. This is the
 * default, dependency-light path and the fallback for the Remotion backend.
 */
export class FfmpegRenderer implements OverlayRenderer {
  readonly backend = "ffmpeg" as const;

  async render(plan: RenderPlan): Promise<void> {
    const burnInText = [plan.logoText, ...plan.overlays].filter((s): s is string => !!s);
    await renderClip9x16({
      inputPath: plan.inputPath,
      outputPath: plan.outputPath,
      startSec: plan.startSec,
      endSec: plan.endSec,
      width: plan.width,
      height: plan.height,
      burnInText,
      normalizeAudio: plan.normalizeAudio,
      trimSilence: plan.trimSilence,
    });
  }
}
