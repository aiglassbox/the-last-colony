/**
 * Deterministic checks for the language pure functions. No model, no network —
 * safe to run in `npm run check` if ever wanted. Run directly:
 *   npm run lang:check
 */
import assert from "node:assert/strict";

import { enFallback, isSupported, type Normalized } from "../src/lib/lang/types";
import { CONFIDENCE_THRESHOLD, parseNormalizeResponse } from "../src/lib/lang/normalize";
import { replyInstruction } from "../src/lib/lang/reply-instruction";
import { EN_LABELS, validateLocalizedCard } from "../src/lib/lang/localized-card";
import { EN_UI_STRINGS, fill, uiStrings } from "../src/lib/lang/ui-strings";
import type { CorpusRecord } from "../src/lib/corpus/types";

let pass = 0;
const check = (name: string, fn: () => void) => {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
};

// isSupported
check("isSupported accepts an active language", () => assert.equal(isSupported("ta"), true));
check("isSupported rejects Urdu (deferred)", () => assert.equal(isSupported("ur"), false));
check("isSupported rejects junk", () => assert.equal(isSupported("xx"), false));

// parseNormalizeResponse — happy path
check("parses a confident Tamil detection", () => {
  const n = parseNormalizeResponse(
    '{"lang":"ta","script":"native","register":"native","confidence":0.98,"english":"idli"}',
    "இட்லி",
  );
  assert.equal(n.lang, "ta");
  assert.equal(n.english, "idli");
  assert.equal(n.fell_back, false);
});

// parseNormalizeResponse — Urdu routes to English fallback but keeps translation
check("Urdu falls back to English, keeps translation", () => {
  const n = parseNormalizeResponse(
    '{"lang":"ur","script":"native","register":"native","confidence":0.95,"english":"biryani"}',
    "بریانی",
  );
  assert.equal(n.lang, "en");
  assert.equal(n.fell_back, true);
  assert.equal(n.english, "biryani");
});

// parseNormalizeResponse — low confidence falls back
check("low confidence falls back", () => {
  const n = parseNormalizeResponse(
    `{"lang":"hi","script":"native","register":"native","confidence":${CONFIDENCE_THRESHOLD - 0.1},"english":"kuch"}`,
    "कुछ",
  );
  assert.equal(n.lang, "en");
  assert.equal(n.fell_back, true);
});

// parseNormalizeResponse — malformed JSON falls back to the original
check("malformed JSON falls back to original", () => {
  const n = parseNormalizeResponse("not json at all", "dosa");
  assert.deepEqual(n, enFallback("dosa"));
});

// parseNormalizeResponse — survives a stray code fence
check("survives a code fence around the JSON", () => {
  const n = parseNormalizeResponse(
    '```json\n{"lang":"hi","script":"native","register":"native","confidence":0.9,"english":"khichdi"}\n```',
    "खिचड़ी",
  );
  assert.equal(n.lang, "hi");
  assert.equal(n.english, "khichdi");
});

// replyInstruction
const mk = (over: Partial<Normalized>): Normalized => ({
  lang: "hi", script: "native", register: "native", confidence: 0.9,
  english: "idli", fell_back: false, ...over,
});

check("instruction names the target language", () => {
  const s = replyInstruction(mk({ lang: "ta", script: "native", register: "native" }));
  assert.match(s, /Tamil/);
  assert.match(s, /native script/);
});

check("hinglish register is mirrored", () => {
  const s = replyInstruction(mk({ lang: "hi", script: "roman", register: "hinglish" }));
  assert.match(s, /Hinglish/i);
});

check("fallback instruction lists supported languages in English", () => {
  const s = replyInstruction(mk({ lang: "en", register: "roman", fell_back: true }));
  assert.match(s, /English/);
  assert.match(s, /Tamil/); // the supported list is named
});

// validateLocalizedCard — a minimal record carrying only the fields the
// validator reads (lengths of ingredients / method / restore_today).
const rec = {
  ingredients: [{ name: "rock salt", sanskrit: "saindhava", quantity_source: null, quantity_modern: "to taste", function: "seasoning" }],
  method_reconstructed: ["Soak the dal.", "Grind it."],
  restore_today: null,
} as unknown as CorpusRecord;

const validRaw = {
  labels: EN_LABELS, // a valid LocalizedLabels payload
  record: {
    verdict: "आपकी इडली",
    ingredients: [{ name: "सेंधा नमक", quantity: "स्वादानुसार", function: "मसाला" }],
    method: ["दाल भिगोएँ।", "पीस लें।"],
    source: { text: "मानसोल्लास", century: "1129", author: null, edition: null, locus: null },
    contested_points: [],
    axes: {},
  },
};

check("validateLocalizedCard parses a well-formed card", () => {
  const card = validateLocalizedCard(rec, "hi", validRaw);
  assert.ok(card);
  assert.equal(card!.record.ingredients[0].name, "सेंधा नमक");
  assert.equal(card!.record.method.length, 2);
  assert.equal(card!.labels.ingredient, EN_LABELS.ingredient);
});

check("validateLocalizedCard rejects an ingredient-count mismatch", () => {
  const bad = { ...validRaw, record: { ...validRaw.record, ingredients: [] } };
  assert.equal(validateLocalizedCard(rec, "hi", bad), null);
});

check("validateLocalizedCard rejects a method-count mismatch", () => {
  const bad = { ...validRaw, record: { ...validRaw.record, method: ["only one step"] } };
  assert.equal(validateLocalizedCard(rec, "hi", bad), null);
});

check("validateLocalizedCard rejects missing labels", () => {
  const { record } = validRaw;
  assert.equal(validateLocalizedCard(rec, "hi", { record }), null);
});

// uiStrings — the page chrome table. English is the table itself; a translated
// language fills every key, keeps the placeholders, and is actually translated.
check("uiStrings falls back to the English table", () => {
  assert.deepEqual(uiStrings(undefined), EN_UI_STRINGS);
  assert.deepEqual(uiStrings("en"), EN_UI_STRINGS);
});

check("uiStrings for Bengali is translated with every key and placeholder intact", () => {
  const t = uiStrings("bn");
  for (const k of Object.keys(EN_UI_STRINGS) as (keyof typeof EN_UI_STRINGS)[]) {
    assert.ok(t[k].trim(), `bn.${k} is empty`);
  }
  assert.notEqual(t.newChat, EN_UI_STRINGS.newChat, "bn table is not translated");
  assert.match(t.deleteConversation, /\{title\}/);
  assert.match(t.restorationsOther, /\{n\}/);
  assert.match(t.messagesOther, /\{n\}/);
});

check("fill substitutes placeholders and leaves unknown ones", () => {
  assert.equal(fill("{n} messages", { n: 3 }), "3 messages");
  assert.equal(fill("Delete: {title}", { title: "Idli" }), "Delete: Idli");
  assert.equal(fill("{x}", {}), "{x}");
});

console.log(`\n✓ ${pass} language checks pass\n`);
