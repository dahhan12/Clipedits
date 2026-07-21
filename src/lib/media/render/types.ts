export interface RenderPlan {
  /** Local path to the source video. */
  inputPath: string;
  /** Where the final MP4 should be written. */
  outputPath: string;
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  /** Overlay text lines (already gated by campaign permission/requirement). */
  overlays: string[];
  logoText?: string;
  /** EBU R128 audio loudness normalization. Default true. */
  normalizeAudio?: boolean;
  /** Trim leading/trailing silence (may shorten duration). Default false. */
  trimSilence?: boolean;
}

/** A backend that turns a RenderPlan into an MP4 at `outputPath`. */
export interface OverlayRenderer {
  readonly backend: "ffmpeg" | "remotion";
  render(plan: RenderPlan): Promise<void>;
}
