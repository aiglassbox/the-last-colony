import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import {
  GoogleGenAI,
  type GenerateContentResponseUsageMetadata,
  type ThinkingConfig,
  ThinkingLevel,
} from "@google/genai";

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

/**
 * What a turn cost, in tokens.
 *
 * Nothing read usage before this, which meant the one number deciding whether
 * a public campaign can afford its own traffic was written down nowhere: the
 * cost of a turn, the size of the prompt, and whether the cache is working at
 * all were each a guess. A launch that cannot answer "what did today cost"
 * finds out from the invoice.
 *
 * `cached` against `prompt` is the hit rate, and it is the line to watch after
 * any prompt edit — caching is a prefix match, so a block moved above the
 * stable span silently takes the discount away and nothing else changes.
 * Its own `[tokens]` prefix, so it can be pulled out of the log the same way
 * `[corpus-gap]` is.
 */
function logAnthropicUsage(where: string, usage: Anthropic.Usage): void {
  console.info(
    `[tokens] ${JSON.stringify({
      vendor: "anthropic",
      model: ANTHROPIC_MODEL,
      where,
      prompt: usage.input_tokens,
      cached: usage.cache_read_input_tokens ?? 0,
      cache_write: usage.cache_creation_input_tokens ?? 0,
      output: usage.output_tokens,
    })}`,
  );
}

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
      logAnthropicUsage("stream", final.usage);
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
      logAnthropicUsage("complete", message.usage);
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

/** See `logAnthropicUsage`. `thoughts` bills as output and never reaches the screen. */
function logGeminiUsage(
  where: string,
  usage: GenerateContentResponseUsageMetadata | undefined,
): void {
  if (!usage) return;
  console.info(
    `[tokens] ${JSON.stringify({
      vendor: "gemini",
      model: GEMINI_MODEL,
      where,
      // Google counts the cached span inside `promptTokenCount`, so these two
      // are a ratio rather than two halves to add up.
      prompt: usage.promptTokenCount ?? 0,
      cached: usage.cachedContentTokenCount ?? 0,
      output: usage.candidatesTokenCount ?? 0,
      thoughts: usage.thoughtsTokenCount ?? 0,
      total: usage.totalTokenCount ?? 0,
    })}`,
  );
}

// --- Gemini context cache ---------------------------------------------------

/**
 * The system prompt, held on Google's side rather than re-sent every turn.
 *
 * It is about 7,600 tokens (measured, not estimated — see `npm run check:cache`),
 * byte-identical on every request, and was billed in full each time. At a
 * hundred thousand turns that is the largest single line on the bill and none
 * of it buys anything the previous turn had not already paid for. Cached, the
 * span is billed once and read back at a fraction.
 *
 * Explicit rather than leaning on the implicit cache, which is best-effort by
 * design: it is not guaranteed to hit, it reports nothing when it stops, and
 * a discount nobody can see is not one anybody can plan against. The two do
 * not conflict — this only removes the doubt.
 *
 * Nothing here is load-bearing. Every failure returns null and the caller
 * sends the prompt inline exactly as it did before, because a cache is a
 * discount and losing a discount must never cost a reader their card.
 */

/** Off by default is wrong here, but a way out without a deploy is not. */
const CACHE_ENABLED = process.env.GEMINI_CACHE !== "off";

/** Long enough that a quiet hour does not drop it, short enough to bound storage. */
const CACHE_TTL_SECONDS = Number(process.env.GEMINI_CACHE_TTL ?? "3600");

/** Renewed this far ahead of expiry, so no turn lands on a handle that just died. */
const CACHE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** How long a refusal is believed before another attempt is made. */
const CACHE_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Below this, caching is not attempted at all.
 *
 * The API declines a prompt under its own minimum, and this seam carries two:
 * the restoration brief, which is worth caching, and the swap note, which is a
 * few hundred characters and is not. Deciding here turns a guaranteed round
 * trip and a rejection into nothing at all.
 */
const MIN_CACHE_CHARS = 8000;

interface CacheAttempt {
  /** Resource name, or null when the cache is unavailable and the turn goes inline. */
  name: string | null;
  /** When this answer stops being trusted and another attempt is made. */
  staleAt: number;
}

/**
 * One creation in flight per distinct prompt, not one per request.
 *
 * The promise is memoised rather than its result: a cold instance taking
 * several turns at once would otherwise build a cache for each of them and pay
 * storage several times over for the same bytes. Two entries at most, since
 * two system prompts exist.
 */
const caches = new Map<string, Promise<CacheAttempt>>();

/** A cache belongs to one model and one prompt; either changing means a new one. */
function cacheKey(system: string): string {
  const digest = createHash("sha256").update(system).digest("hex").slice(0, 16);
  return `${GEMINI_MODEL}:${digest}`;
}

async function createCache(client: GoogleGenAI, system: string): Promise<CacheAttempt> {
  try {
    const cache = await client.caches.create({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: system,
        ttl: `${CACHE_TTL_SECONDS}s`,
        displayName: "the-last-colony system prompt",
      },
    });
    if (!cache.name) throw new Error("created without a resource name");

    // The server's own expiry is preferred over the requested TTL: they differ
    // when the service clamps it, and trusting our own arithmetic there would
    // keep a dead handle in play for the difference.
    const expiresAt = cache.expireTime
      ? Date.parse(cache.expireTime)
      : Date.now() + CACHE_TTL_SECONDS * 1000;

    console.info(
      `[cache] ${JSON.stringify({
        model: GEMINI_MODEL,
        name: cache.name,
        tokens: cache.usageMetadata?.totalTokenCount ?? null,
        expires: cache.expireTime ?? null,
      })}`,
    );
    return { name: cache.name, staleAt: expiresAt - CACHE_REFRESH_MARGIN_MS };
  } catch (error) {
    // Said plainly and not fatally. The turn still answers; it just costs full
    // price, and the log is where that shows up before the invoice does.
    console.warn(
      "[cache] unavailable, sending the prompt inline: " +
        `${error instanceof Error ? error.message : error}`,
    );
    return { name: null, staleAt: Date.now() + CACHE_RETRY_AFTER_MS };
  }
}

/**
 * Whether a rejected request is the cache's fault rather than the turn's.
 *
 * A handle can stop working before it expires — deleted out from under the
 * process, or pinned to a model version the alias has since rotated past — and
 * the service says so in words: "CachedContent not found (or permission
 * denied)". Matching the message rather than a status code, because 403 and
 * 404 both arrive here for reasons that have nothing to do with caching and a
 * bad key should fail loudly rather than be retried into the same wall.
 */
function isCacheError(error: unknown): boolean {
  return /cach/i.test(error instanceof Error ? error.message : String(error));
}

/** Forget a handle the service has just refused, so the next turn rebuilds it. */
function dropCache(system: string): void {
  caches.delete(cacheKey(system));
}

/** The cache resource to use for this prompt, or null to send it inline. */
async function systemCache(client: GoogleGenAI, system: string): Promise<string | null> {
  if (!CACHE_ENABLED || system.length < MIN_CACHE_CHARS) return null;

  const key = cacheKey(system);
  for (;;) {
    const pending = caches.get(key);
    if (!pending) {
      const next = createCache(client, system);
      caches.set(key, next);
      return (await next).name;
    }

    const attempt = await pending;
    if (attempt.staleAt > Date.now()) return attempt.name;

    // Only the turn still holding the entry that went stale clears it. Without
    // that check two turns arriving together on an expiring cache would each
    // discard the other's replacement and build a third.
    if (caches.get(key) === pending) caches.delete(key);
  }
}

function geminiProvider(): ModelProvider {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const build = async (req: StreamRequest, signal?: AbortSignal, inline = false) => {
    // `inline` is the retry after a handle was refused. It must not ask for a
    // cache again: the entry has just been dropped, so asking would build a
    // fresh one and spend the round trip the retry exists to avoid.
    const cached = inline ? null : await systemCache(client, req.system);
    return {
      model: GEMINI_MODEL,
      // Gemini names the assistant role "model", and takes the system prompt as
      // a separate instruction rather than a message.
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      })),
      config: {
        // The prompt travels one way or the other and never both: a request
        // that sets `systemInstruction` alongside a cache already holding one
        // is refused, so the cached path has to leave the field off entirely.
        cachedContent: cached ?? undefined,
        systemInstruction: cached ? undefined : req.system,
        maxOutputTokens: req.maxTokens,
        thinkingConfig: GEMINI_THINKING,
        abortSignal: signal,
      },
    };
  };

  /**
   * The request, with one inline retry if the cached span turns out to be gone.
   *
   * Creation already falls back — a cache that cannot be built sends the prompt
   * inline and the turn never notices. Using one did not: a handle refused at
   * request time threw straight past the caller, which is the one way a
   * discount could cost a reader their answer instead of costing money. Now the
   * dead entry is dropped and the same turn goes again without it, so the next
   * turn rebuilds the cache and this one still gets its card.
   *
   * Only the opening call is covered. A stream that dies after tokens have
   * already reached the reader cannot be retried — the reader would watch the
   * answer start over — so that propagates, as it did before.
   */
  const send = async <T>(
    req: StreamRequest,
    call: (params: Awaited<ReturnType<typeof build>>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const params = await build(req, signal);
    try {
      return await call(params);
    } catch (error) {
      if (!params.config.cachedContent || !isCacheError(error)) throw error;
      console.warn(
        "[cache] handle refused, retrying with the prompt inline: " +
          `${error instanceof Error ? error.message : error}`,
      );
      dropCache(req.system);
      return call(await build(req, signal, true));
    }
  };

  return {
    vendor: "gemini",
    model: GEMINI_MODEL,

    async *streamText(req, signal) {
      const stream = await send(req, (params) => client.models.generateContentStream(params), signal);
      let usage: GenerateContentResponseUsageMetadata | undefined;
      try {
        for await (const chunk of stream) {
          // Usage is finalised on the last chunk, but which chunk that is is
          // not ours to assume; the most recent one seen is the whole count.
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
          const text = chunk.text;
          if (text) yield text;
        }
      } finally {
        // A reader pressing stop still spent whatever was generated before
        // they did, so the accounting runs on the way out rather than only on
        // a clean finish.
        logGeminiUsage("stream", usage);
      }
    },

    async completeText(req) {
      const res = await send(req, (params) => client.models.generateContent(params));
      logGeminiUsage("complete", res.usageMetadata);
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
