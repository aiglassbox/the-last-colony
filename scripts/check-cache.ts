/**
 * Context-cache check.
 *
 * `check:routing` proves what a message becomes; this proves what it costs.
 * It is the only check here that spends money and needs a key, which is why it
 * is not part of `npm run check` — run it deliberately, after any prompt edit
 * and before any deploy that claims a caching win.
 *
 * The assertion is on the log lines rather than on the provider's internals,
 * on purpose: `[tokens]` and `[cache]` are what production actually has to
 * read, so a format that drifts should fail here rather than quietly stop
 * being parseable six weeks into a campaign.
 *
 * Two turns, identical system prompt. The first may write the cache, the
 * second must read it. A second turn reporting zero cached tokens is the whole
 * failure this exists to catch — everything still answers, it just costs full
 * price and nothing on screen says so.
 */
import "dotenv/config";

import { activeProvider, MAX_TOKENS } from "../src/lib/model/provider";
import { SYSTEM_PROMPT } from "../src/lib/model/system-prompt";

/** Short and cheap. This checks billing, not answer quality. */
const PROBE = "poha";

/** Gemini 3.6 Flash introductory input rate, USD per million tokens. */
const PRICE_IN = 0.75;
/** Cache reads bill at roughly a tenth of the input rate. */
const CACHE_READ_FACTOR = 0.1;

interface Tokens {
  vendor: string;
  model: string;
  where: string;
  prompt: number;
  cached: number;
  output: number;
  thoughts?: number;
}

/**
 * Collects the provider's own log lines instead of reading its internals.
 *
 * Restored in a `finally` by the caller — a check that leaves `console.info`
 * monkey-patched would swallow every later line in the process.
 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const info = console.info;
  const warn = console.warn;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.info = info;
      console.warn = warn;
    },
  };
}

function parse<T>(lines: string[], prefix: string): T[] {
  return lines
    .filter((l) => l.startsWith(prefix))
    .flatMap((l) => {
      try {
        return [JSON.parse(l.slice(prefix.length).trim()) as T];
      } catch {
        // A line that cannot be parsed is itself the finding — production
        // reads these the same way, so say so rather than skipping quietly.
        console.error(`  ✗ unparseable ${prefix} line: ${l}`);
        return [];
      }
    });
}

async function turn(): Promise<{ tokens: Tokens | null; cacheLines: string[] }> {
  const provider = activeProvider();
  if (!provider) throw new Error("no provider");

  const { lines, restore } = capture();
  try {
    const stream = provider.streamText({
      system: SYSTEM_PROMPT,
      maxTokens: MAX_TOKENS,
      messages: [{ role: "user", content: PROBE }],
    });
    // Drained and discarded. The prose is not what is under test.
    for await (const _ of stream) void _;
  } finally {
    restore();
  }

  return {
    tokens: parse<Tokens>(lines, "[tokens]")[0] ?? null,
    cacheLines: lines.filter((l) => l.startsWith("[cache]")),
  };
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function main(): Promise<void> {
  const provider = activeProvider();

  if (!provider) {
    console.error(
      "No model key set. Put GEMINI_API_KEY in .env (gitignored) and run again.\n" +
        "This check spends two model calls, roughly two cents.",
    );
    process.exit(1);
  }

  if (provider.vendor !== "gemini") {
    console.error(
      `Provider is ${provider.vendor}, and context caching here is the Gemini path.\n` +
        "Unset MODEL_PROVIDER, or set MODEL_PROVIDER=gemini, and run again.",
    );
    process.exit(1);
  }

  if (process.env.GEMINI_CACHE === "off") {
    console.error("GEMINI_CACHE=off — unset it to check the cache.");
    process.exit(1);
  }

  console.log(`model: ${provider.model}`);
  console.log(`system prompt: ${SYSTEM_PROMPT.length} chars\n`);

  const first = await turn();
  for (const l of first.cacheLines) console.log(`  ${l}`);
  const second = await turn();
  for (const l of second.cacheLines) console.log(`  ${l}`);

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };

  console.log("\nturn   prompt    cached   output  thoughts   hit rate");
  console.log("--------------------------------------------------------");
  for (const [label, t] of [
    ["1", first.tokens],
    ["2", second.tokens],
  ] as const) {
    if (!t) {
      fail(`turn ${label} emitted no [tokens] line`);
      continue;
    }
    const rate = t.prompt ? ((t.cached / t.prompt) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${label}  ${String(t.prompt).padStart(7)}  ${String(t.cached).padStart(8)}` +
        `  ${String(t.output).padStart(7)}  ${String(t.thoughts ?? 0).padStart(8)}` +
        `  ${rate.padStart(8)}%`,
    );
  }
  console.log();

  // The second turn is the one that matters. The first may legitimately be a
  // cache write, and on a warm instance it is already a read.
  const t2 = second.tokens;
  if (t2) {
    if (t2.cached <= 0) {
      fail(
        "turn 2 read nothing from cache. The prompt is being billed in full on " +
          "every request — check the [cache] line above for the reason.",
      );
    }
    if (t2.prompt <= 0) fail("turn 2 reported no prompt tokens at all");

    if (t2.cached > 0 && t2.prompt > 0) {
      // Only the saving is projected, and deliberately not the turn total.
      // The probe is one word, so `prompt` here is the system prompt and
      // almost nothing else — a real turn carries the swap table, the
      // Indianisation map and the resolve instructions on top, and its total
      // is roughly double. What does not change with prompt size is the
      // cached span, so the saving below holds for any turn and the hit rate
      // above does not: expect it near 40% in production, not 100%.
      const saved =
        (t2.cached * PRICE_IN * (1 - CACHE_READ_FACTOR)) / 1e6;

      console.log(
        `cached span   ${t2.cached} tokens   saves ${usd(saved)} per turn, any turn size`,
      );
      for (const n of [100_000, 200_000]) {
        console.log(`  at ${(n / 1000).toFixed(0)}k turns: saves ~$${Math.round(saved * n)}`);
      }
      console.log(
        "\n  Rates are Gemini 3.6 Flash introductory ($0.75/$3.75 per M) and a\n" +
          "  10% cache-read factor, and they double when the introductory period\n" +
          "  ends. Confirm both against current pricing before quoting these\n" +
          "  numbers anywhere that matters.",
      );
    }
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\ncache is live and being read");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
