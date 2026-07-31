import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * The model seam.
 *
 * Everything above this file — the four-beat contract, the corpus block, the
 * turn-mode routing, the beat parser — is provider-agnostic prose generation.
 * Only this file knows whose API is answering, so swapping vendors is one
 * implementation rather than a rewrite of the route.
 *
 * Selection is by whichever key is present, with MODEL_PROVIDER as an override
 * when both are.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
}

export interface ModelProvider {
  /** For logs and the /api/health surface. */
  readonly vendor: "anthropic" | "gemini";
  readonly model: string;
  streamText(req: StreamRequest, signal?: AbortSignal): AsyncIterable<string>;
  completeText(req: StreamRequest): Promise<string>;
}

// --- Anthropic -------------------------------------------------------------

const ANTHROPIC_MODEL = process.env.RESTORATION_MODEL ?? "claude-opus-5";
const ANTHROPIC_EFFORT = (process.env.RESTORATION_EFFORT ?? "low") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

function anthropicProvider(): ModelProvider {
  const client = new Anthropic();

  /**
   * The prompt is long, frozen and identical on every request, which is what
   * caching is for. Volatile content — records, mode, query — sits in the
   * messages, after the breakpoint.
   */
  const system = (text: string): Anthropic.TextBlockParam[] => [
    { type: "text", text, cache_control: { type: "ephemeral" } },
  ];

  return {
    vendor: "anthropic",
    model: ANTHROPIC_MODEL,

    async *streamText(req, signal) {
      const stream = client.messages.stream(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: req.maxTokens,
          output_config: { effort: ANTHROPIC_EFFORT },
          system: system(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") throw new RefusalError();
    },

    async completeText(req) {
      const message = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: req.maxTokens,
        output_config: { effort: ANTHROPIC_EFFORT },
        system: system(req.system),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();
    },
  };
}

// --- Gemini ----------------------------------------------------------------

/**
 * `gemini-2.5-flash` is the default because it is what the supplied key
 * actually has quota for — the Gemini 3 models list as available and then
 * return 429 on this key. Override with GEMINI_MODEL.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * Thinking is on by default on 2.5 and nothing streams until it finishes,
 * which on a chat surface reads as a dead screen. Zero keeps the verdict line
 * fast; raise GEMINI_THINKING_BUDGET (or -1 for dynamic) if replies feel thin.
 */
const GEMINI_THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? "0");

function geminiProvider(): ModelProvider {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const build = (req: StreamRequest) => ({
    model: GEMINI_MODEL,
    // Gemini names the assistant role "model", and takes the system prompt as
    // a separate instruction rather than a message.
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    })),
    config: {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens,
      thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
      abortSignal: undefined as AbortSignal | undefined,
    },
  });

  return {
    vendor: "gemini",
    model: GEMINI_MODEL,

    async *streamText(req, signal) {
      const params = build(req);
      params.config.abortSignal = signal;
      const stream = await client.models.generateContentStream(params);
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield text;
      }
    },

    async completeText(req) {
      const res = await client.models.generateContent(build(req));
      return (res.text ?? "").trim();
    },
  };
}

// --- selection -------------------------------------------------------------

/** Thrown when the provider's safety layer declines rather than answers. */
export class RefusalError extends Error {
  constructor() {
    super("The model declined this request.");
    this.name = "RefusalError";
  }
}

/**
 * Quota exhaustion, told apart from a transient failure.
 *
 * The Gemini free tier allows 20 requests per day per model, which a single
 * afternoon of testing will spend. "Try again" is the wrong advice for that —
 * retrying cannot fix it — so it gets its own message.
 */
export class QuotaError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super("The model provider's quota is exhausted.");
    this.name = "QuotaError";
  }
}

export function asQuotaError(err: unknown): QuotaError | null {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : "";
  if (status !== 429 && !/RESOURCE_EXHAUSTED|quota/i.test(message)) return null;
  const retry = /"retryDelay":\s*"(\d+)s"/.exec(message);
  return new QuotaError(retry ? Number(retry[1]) : null);
}

export function activeProvider(): ModelProvider | null {
  const forced = process.env.MODEL_PROVIDER?.toLowerCase();

  if (forced === "gemini") return process.env.GEMINI_API_KEY ? geminiProvider() : null;
  if (forced === "anthropic") return process.env.ANTHROPIC_API_KEY ? anthropicProvider() : null;

  if (process.env.GEMINI_API_KEY) return geminiProvider();
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider();
  return null;
}

export const MAX_TOKENS = 8000;
