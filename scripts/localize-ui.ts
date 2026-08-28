/**
 * Precompute the recordless-card UI chrome per language.
 *   npm run localize:ui            # all non-English languages
 *   npm run localize:ui -- --force # ignored; always regenerates every language
 *
 * One structured model call per language, translating EN_CARD_STRINGS into the
 * language's native script, written to src/lib/lang/card-strings.data.json
 * (committed, reviewable, bundled into the client). Live (spends API), never
 * part of `npm run check`. Re-run after editing EN_CARD_STRINGS.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { EN_CARD_STRINGS, type CardStrings } from "../src/lib/lang/card-strings";
import { LANG_NAMES, SUPPORTED_LANGS, type SupportedLang } from "../src/lib/lang/types";
import { activeProvider } from "../src/lib/model/provider";

const LANGS = SUPPORTED_LANGS.filter((l): l is Exclude<SupportedLang, "en"> => l !== "en");
const OUT = join(process.cwd(), "src", "lib", "lang", "card-strings.data.json");

function systemPrompt(name: string): string {
  return (
    `You are localizing the fixed UI labels of a recipe card into ${name}.\n\n` +
    `You will receive ONE JSON object of English values. Return ONE JSON object ` +
    `with the EXACT same structure and the same keys, every string VALUE ` +
    `translated into ${name} in its native script. Nothing else — no markdown, ` +
    `no code fence, no commentary.\n\n` +
    `Rules:\n` +
    `- Keep every JSON key in English exactly as given.\n` +
    `- Translate the meaning naturally, not word for word; these are short card ` +
    `headings and one-line notes.\n` +
    `- Keep the arrow character "→" exactly as it is.\n` +
    `- No health claims, no added advice.`
  );
}

async function main() {
  const provider = activeProvider();
  if (!provider) {
    console.error("No model provider (set GEMINI_API_KEY or ANTHROPIC_API_KEY).");
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  // Incremental: keep languages already translated so a retry only fills the
  // gaps and a transient failure never drops a good one.
  const table: Partial<Record<SupportedLang, CardStrings>> = force
    ? {}
    : (() => {
        try {
          return JSON.parse(readFileSync(OUT, "utf8")) as Partial<Record<SupportedLang, CardStrings>>;
        } catch {
          return {};
        }
      })();
  let failed = 0;

  for (const lang of LANGS) {
    if (!force && table[lang]) {
      console.log(`  skip ${lang} (already present)`);
      continue;
    }
    try {
      const raw = await provider.completeText({
        system: systemPrompt(LANG_NAMES[lang]),
        maxTokens: 1600,
        temperature: 0,
        messages: [{ role: "user", content: JSON.stringify(EN_CARD_STRINGS) }],
      });
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      table[lang] = JSON.parse(raw.slice(start, end + 1)) as CardStrings;
      console.log(`  ok  ${lang}`);
    } catch {
      failed++;
      console.log(`  FAIL ${lang}`);
    }
  }

  writeFileSync(OUT, JSON.stringify(table, null, 2) + "\n");
  console.log(`\nwrote ${Object.keys(table).length} language(s) to ${OUT}, failed ${failed}`);
  if (failed) process.exit(1);
}

main();
