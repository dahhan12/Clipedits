import { z } from "zod";
import { PlatformEnum } from "@/lib/schemas/campaign";

/**
 * The render manifest — a complete, auditable description of every
 * transformation applied to produce a rendered clip. Persisted on
 * `RenderedClip.renderManifest` and consulted by the compliance engine to
 * verify that mandatory overlays / text / mentions were actually applied.
 */

export const OverlayKindEnum = z.enum(["CAPTION", "LOGO", "MENTION", "TEXT", "HASHTAG"]);

export const AppliedOverlaySchema = z.object({
  kind: OverlayKindEnum,
  value: z.string(),
  // Whether this overlay was required by the campaign (vs. merely permitted).
  required: z.boolean().default(false),
});
export type AppliedOverlay = z.infer<typeof AppliedOverlaySchema>;

export const TransformationSchema = z.object({
  step: z.string(),
  detail: z.string().default(""),
});

export const RenderManifestSchema = z.object({
  sourceAssetId: z.string(),
  candidateId: z.string(),
  backend: z.enum(["ffmpeg", "remotion"]),
  range: z.object({ startSec: z.number(), endSec: z.number() }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string(),
  videoCodec: z.string(),
  audioCodec: z.string(),
  container: z.string(),
  transformations: z.array(TransformationSchema),
  overlaysApplied: z.array(AppliedOverlaySchema),
  // Platform-specific caption text produced for publishing.
  captions: z.record(PlatformEnum, z.string()),
  // True when the campaign requires official in-app audio/stickers/effects,
  // which forces DRAFT/MANUAL publishing downstream.
  requiresInAppAudioOrEffects: z.boolean().default(false),
  createdAt: z.string(),
});
export type RenderManifest = z.infer<typeof RenderManifestSchema>;
