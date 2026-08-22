/**
 * Deterministic checks for the language pure functions. No model, no network —
 * safe to run in `npm run check` if ever wanted. Run directly:
 *   npm run lang:check
 */
import assert from "node:assert/strict";

import { enFallback, isSupported } from "../src/lib/lang/types";
import { CONFIDENCE_THRESHOLD, parseNormalizeResponse } from "../src/lib/lang/normalize";

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

console.log(`\n✓ ${pass} language checks pass\n`);
