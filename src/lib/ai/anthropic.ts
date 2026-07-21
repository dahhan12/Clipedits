import Anthropic from "@anthropic-ai/sdk";
import { env, isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { recordProviderCall } from "@/lib/observability/providerMetrics";
import { recordUsage } from "@/services/ops/costService";

/**
 * Thin wrapper around the Anthropic SDK that:
 *  - lazily constructs the client,
 *  - exposes a `extractStructured` helper that forces the model to answer via a
 *    single tool call whose input schema is the caller's JSON schema, and
 *  - supports a sandbox mode (no API key) that returns a caller-provided
 *    fallback so the pipeline is exercisable end-to-end without live calls.
 *
 * Callers ALWAYS re-validate the returned object with Zod. The raw tool input
 * is never trusted directly.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface ExtractOptions<T> {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  /** Returned verbatim when running in sandbox mode (no ANTHROPIC_API_KEY). */
  sandboxFallback: T;
  maxTokens?: number;
}

/**
 * Ask the model to produce a structured object via a forced tool call.
 * Returns the raw (unvalidated) tool input; the caller validates with Zod.
 */
export async function extractStructured<T>(opts: ExtractOptions<T>): Promise<unknown> {
  if (isSandbox.anthropic()) {
    logger.warn({ tool: opts.toolName }, "Anthropic sandbox mode: returning fallback");
    return opts.sandboxFallback;
  }

  const resp = await recordProviderCall("anthropic", `extract:${opts.toolName}`, () =>
    getClient().messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.prompt }],
    }),
  );

  void recordUsage({ kind: "ai" });
  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Model did not return a tool_use block");
  }
  return toolUse.input;
}

/**
 * Extract plain campaign text from an uploaded image (screenshot) or PDF using
 * Claude's vision/document support. Returns "" in sandbox mode (no API key) so
 * the caller can report that extraction needs a live model rather than
 * fabricating content.
 */
export async function extractTextFromMedia(input: {
  base64: string;
  mediaType: string;
}): Promise<string> {
  if (isSandbox.anthropic()) {
    logger.warn("Anthropic sandbox mode: cannot extract text from media");
    return "";
  }

  const isPdf = input.mediaType === "application/pdf";
  const mediaBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } }
    : {
        type: "image",
        source: { type: "base64", media_type: input.mediaType, data: input.base64 },
      };

  // The installed SDK version does not yet type the `document` (PDF) block,
  // though the API accepts it; cast the content to the SDK's param type.
  const content = [
    mediaBlock,
    { type: "text", text: "Transcribe ALL visible campaign text from this document verbatim. Output only the text, no commentary." },
  ] as unknown as Anthropic.MessageParam["content"];

  const resp = await recordProviderCall("anthropic", "extractTextFromMedia", () =>
    getClient().messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
  );

  void recordUsage({ kind: "ai" });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
