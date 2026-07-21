import { TranscriptSchema, type Transcript } from "@/lib/schemas/media";
import type { TranscribeInput, Transcriber } from "./types";

/**
 * Deterministic sandbox transcriber used when no live ASR backend is
 * configured. It produces a valid, clearly-labelled placeholder transcript
 * (uniform segments across the known duration) so the downstream clip pipeline
 * is fully exercisable offline. Swap for a Whisper/Deepgram adapter in prod.
 */
export class SandboxTranscriber implements Transcriber {
  readonly name = "sandbox";

  async transcribe(input: TranscribeInput): Promise<Transcript> {
    const duration = input.durationSec ?? 0;
    const segments: Transcript["segments"] = [];
    const step = 15;
    for (let t = 0; t < duration; t += step) {
      segments.push({
        startSec: t,
        endSec: Math.min(t + step, duration),
        text: `[sandbox transcript segment ${Math.floor(t / step) + 1}]`,
      });
    }
    return TranscriptSchema.parse({
      language: "und",
      durationSec: input.durationSec,
      segments,
      provider: "sandbox",
    });
  }
}
