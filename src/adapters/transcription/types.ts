import type { Transcript } from "@/lib/schemas/media";

export interface TranscribeInput {
  /** Local path to the media file. */
  path: string;
  durationSec: number | null;
}

/** A transcription backend (Whisper, Deepgram, …). */
export interface Transcriber {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<Transcript>;
}
