import { z } from "zod";

/** A single timestamped transcript segment. */
export const TranscriptSegmentSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSchema = z.object({
  language: z.string().default("und"),
  durationSec: z.number().nonnegative().nullable(),
  segments: z.array(TranscriptSegmentSchema),
  provider: z.string(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** Claude clip scores; each 0..1. */
export const ClipScoresSchema = z.object({
  hookStrength: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  emotionalIntensity: z.number().min(0).max(1),
  campaignRelevance: z.number().min(0).max(1),
  standaloneValue: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  rationale: z.string().default(""),
});
export type ClipScores = z.infer<typeof ClipScoresSchema>;
