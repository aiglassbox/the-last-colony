/**
 * Precompute the fixed UI strings per language.
 *   npm run localize:ui            # every language missing from either table
 *   npm run localize:ui -- --force # regenerate every language in both tables
 *
 * Two English tables, one structured model call per language per table,
 * translated into the language's native script and written to a committed
 * JSON beside the source (reviewable, bundled into the client):
 *
 *   EN_CARD_STRINGS -> src/lib/lang/card-strings.data.json  (recordless card chrome)
 *   EN_UI_STRINGS   -> src/lib/lang/ui-strings.data.json    (page chrome)
 *
 * Live (spends API), never part of `npm run check`. Re-run after editing
 * either English table.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { EN_CARD_STRINGS } from "../src/lib/lang/card-strings";
import { EN_UI_STRINGS } from "../src/lib/lang/ui-strings";
import { LANG_NAMES, SUPPORTED_LANGS, type SupportedLang } from "../src/lib/lang/types";
import { activeProvider } from "../src/lib/model/provider";

const LANGS = SUPPORTED_LANGS.filter((l): l is Exclude<SupportedLang, "en"> => l !== "en");
const DIR = join(process.cwd(), "src", "lib", "lang");

const JOBS = [
  { source: EN_CARD_STRINGS, out: "card-strings.data.json" },
  { source: EN_UI_STRINGS, out: "ui-strings.data.json" },
];

function systemPrompt(name: string): string {
  return (
    `You are localizing the fixed UI labels of a recipe app into ${name}.\n\n` +
    `You will receive ONE JSON object of English values. Return ONE JSON object ` +
    `with the EXACT same structure and the same keys, every string VALUE ` +
    `translated into ${name} in its native script. Nothing else — no markdown, ` +
    `no code fence, no commentary.\n\n` +
    `Rules:\n` +
    `- Keep every JSON key in English exactly as given.\n` +
    `- Translate the meaning naturally, not word for word; these are short ` +
    `headings, button labels and one-line notes.\n` +
    `- Keep the arrow character "→" exactly as it is.\n` +
    `- Keep any placeholder in curly braces, like {n} or {title}, exactly as it ` +
    `is; code fills it in.\n` +
    `- No health claims, no added advice.`
  );
}

type Strings = Record<string, unknown>;
type Table = Partial<Record<SupportedLang, Strings>>;

function existing(path: string): Table {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Table;
  } catch {
    return {};
  }
}

/** The top-level keys of `source` that `have` does not carry yet. */
function missing(source: Strings, have: Strings | undefined): Strings {
  const out: Strings = {};
  for (const [k, v] of Object.entries(source)) {
    if (!have || !(k in have)) out[k] = v;
  }
  return out;
}

async function main() {
  const provider = activeProvider();
  if (!provider) {
    console.error("No model provider (set GEMINI_API_KEY or ANTHROPIC_API_KEY).");
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  let failed = 0;

  for (const job of JOBS) {
    const path = join(DIR, job.out);
    // Incremental, per key: a language already on disk is only asked for the
    // keys it lacks, so adding a string to the English table translates that
    // string and leaves every reviewed translation exactly as it was. A
    // transient failure never drops a good one either.
    const table: Table = force ? {} : existing(path);
    console.log(job.out);

    for (const lang of LANGS) {
      const todo = missing(job.source as Strings, table[lang]);
      if (Object.keys(todo).length === 0) {
        console.log(`  skip ${lang} (complete)`);
        continue;
      }
      try {
        const raw = await provider.completeText({
          system: systemPrompt(LANG_NAMES[lang]),
          maxTokens: 1600,
          temperature: 0,
          messages: [{ role: "user", content: JSON.stringify(todo) }],
        });
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        const got = JSON.parse(raw.slice(start, end + 1)) as Strings;
        table[lang] = { ...(table[lang] ?? {}), ...got };
        console.log(`  ok  ${lang} (${Object.keys(todo).length} key(s))`);
      } catch {
        failed++;
        console.log(`  FAIL ${lang}`);
      }
    }

    writeFileSync(path, JSON.stringify(table, null, 2) + "\n");
    console.log(`  wrote ${Object.keys(table).length} language(s) to ${path}\n`);
  }

  if (failed) {
    console.error(`${failed} translation(s) failed; re-run to fill the gaps.`);
    process.exit(1);
  }
}

main();
