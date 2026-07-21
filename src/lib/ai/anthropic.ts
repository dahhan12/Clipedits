import Anthropic from "@anthropic-ai/sdk";
import { env, isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

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

  const resp = await getClient().messages.create({
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
  });

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Model did not return a tool_use block");
  }
  return toolUse.input;
}
