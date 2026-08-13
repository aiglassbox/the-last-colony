import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type ThinkingConfig, ThinkingLevel } from "@google/genai";

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
      // Same check the streaming path makes. Without it a declined completion
      // returned as empty text and read as a model that had nothing to say.
      if (message.stop_reason === "refusal") throw new RefusalError();
      return message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();
    },
  };
}

// --- Gemini ----------------------------------------------------------------

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/**
 * How thinking is asked for changed between generations, and the two spellings
 * are not interchangeable: 3.x rejects `thinkingBudget` outright with a 400
 * "Request contains an invalid argument", which surfaces as a card with no
 * prose. Verified against the API — a bare request and one with `thinkingLevel`
 * both answer; the same request with `thinkingBudget: 0` is the only one that
 * fails.
 */
const IS_GEMINI_3_OR_LATER = /^gemini-(?:[3-9]|\d{2,})\b/.test(GEMINI_MODEL);

/**
 * Thinking is on by default and nothing streams until it finishes, which on a
 * chat surface reads as a dead screen. The lowest setting keeps the verdict
 * line fast; raise it if replies feel thin.
 *
 * 2.x counts tokens (GEMINI_THINKING_BUDGET, -1 for dynamic). 3.x takes a
 * level (GEMINI_THINKING_LEVEL: MINIMAL | LOW | MEDIUM | HIGH).
 */
const GEMINI_THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? "0");

/** Falls back to MINIMAL on anything unrecognised rather than 400ing at runtime. */
const GEMINI_THINKING_LEVEL =
  ThinkingLevel[
    (process.env.GEMINI_THINKING_LEVEL ?? "MINIMAL").toUpperCase() as keyof typeof ThinkingLevel
  ] ?? ThinkingLevel.MINIMAL;

const GEMINI_THINKING: ThinkingConfig = IS_GEMINI_3_OR_LATER
  ? { thinkingLevel: GEMINI_THINKING_LEVEL }
  : { thinkingBudget: GEMINI_THINKING_BUDGET };

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
      thinkingConfig: GEMINI_THINKING,
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
