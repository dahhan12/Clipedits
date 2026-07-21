import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { TranscriptSchema, type Transcript } from "@/lib/schemas/media";
import type { TranscribeInput, Transcriber } from "./types";

/**
 * Whisper-compatible transcription (OpenAI-style `/audio/transcriptions`).
 *
 * Requests `verbose_json` with word-level timestamps and maps the response into
 * our Transcript shape (segments + per-word timing). Requires WHISPER_API_URL
 * and WHISPER_API_KEY; when absent, `transcribeService` uses the sandbox
 * transcriber instead.
 */
export class WhisperTranscriber implements Transcriber {
  readonly name = "whisper";

  async transcribe(input: TranscribeInput): Promise<Transcript> {
    const audio = await readFile(input.path);
    const form = new FormData();
    form.append("file", new Blob([audio]), basename(input.path) || "audio.wav");
    form.append("model", env.WHISPER_MODEL);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    form.append("timestamp_granularities[]", "word");

    const resp = await fetch(`${env.WHISPER_API_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHISPER_API_KEY}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`Whisper API returned ${resp.status}`);

    const body = (await resp.json()) as {
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
      words?: Array<{ word: string; start: number; end: number }>;
    };

    const words = (body.words ?? []).map((w) => ({ word: w.word, startSec: w.start, endSec: w.end }));
    const segments = (body.segments ?? []).map((s) => ({
      startSec: s.start,
      endSec: s.end,
      text: s.text.trim(),
      words: words.filter((w) => w.endSec > s.start && w.startSec < s.end),
    }));

    logger.info({ segments: segments.length, words: words.length }, "Whisper transcription complete");
    return TranscriptSchema.parse({
      language: body.language ?? "und",
      durationSec: body.duration ?? input.durationSec,
      segments,
      provider: "whisper",
    });
  }
}
