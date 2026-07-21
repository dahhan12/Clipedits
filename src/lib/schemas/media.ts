import { z } from "zod";

/** A single word with its timestamps (word-level transcription). */
export const TranscriptWordSchema = z.object({
  word: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

/** A single timestamped transcript segment, optionally with word-level timing. */
export const TranscriptSegmentSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).optional(),
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
