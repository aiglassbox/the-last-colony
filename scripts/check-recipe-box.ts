/**
 * Pins the recipe box: the labels the Add Recipe form's beacons carry, and,
 * as its tabs land, the dashboard's arithmetic.
 *
 *   npx tsx scripts/check-recipe-box.ts
 *
 * Model-free and offline, and part of `npm run check`. `DATABASE_URL` is
 * cleared first so the beacon round-trip below can never write a row into a
 * real event log.
 */
import { NextRequest } from "next/server";

import { MAX_FINISH_MS, outcomeOf, stepProps, type AnsweredStep, type StepResult } from "../src/app/add-recipe/track";
import { POST as trackRoute } from "../src/app/api/track/route";
import { trackPixel } from "../src/lib/meta-pixel";

delete process.env.DATABASE_URL;

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

const same = (a: StepResult, b: StepResult) => a.outcome === b.outcome && a.reason === b.reason;

// --- outcomeOf: every status the form and the verify widget handle ---------
const cases: [AnsweredStep, number | "network", unknown, StepResult][] = [
  ["photo_read", 201, { extracted: { recipe_name: "x" } }, { outcome: "ok" }],
  ["photo_read", 201, {}, { outcome: "refused", reason: "unavailable" }],
  ["photo_read", 422, { error: "not_recipe" }, { outcome: "not_recipe" }],
  ["photo_read", 422, { error: "unreadable" }, { outcome: "unreadable" }],
  ["photo_read", 422, null, { outcome: "unreadable" }],
  ["photo_read", 429, { retryAfter: 60 }, { outcome: "refused", reason: "rate_limited" }],
  ["photo_read", 413, null, { outcome: "refused", reason: "too_large" }],
  ["photo_read", 400, { errors: ["bad"] }, { outcome: "refused", reason: "invalid_photo" }],
  ["photo_read", 503, { error: "unavailable" }, { outcome: "refused", reason: "unavailable" }],
  ["photo_read", "network", undefined, { outcome: "refused", reason: "network" }],
  ["code_send", 200, { ok: true }, { outcome: "ok" }],
  ["code_send", 429, { error: "daily" }, { outcome: "refused", reason: "daily_cap" }],
  ["code_send", 429, { error: "cooldown" }, { outcome: "refused", reason: "cooldown" }],
  ["code_send", 429, { error: "cap" }, { outcome: "refused", reason: "cap" }],
  ["code_send", 429, { error: "rate_limited" }, { outcome: "refused", reason: "rate_limited" }],
  ["code_send", 429, { error: "constructor" }, { outcome: "refused", reason: "rate_limited" }],
  ["code_send", 400, { errors: ["x"] }, { outcome: "refused", reason: "bad_email" }],
  ["code_send", 413, null, { outcome: "refused", reason: "unavailable" }],
  ["code_send", 503, null, { outcome: "refused", reason: "unavailable" }],
  ["code_send", "network", undefined, { outcome: "refused", reason: "network" }],
  ["code_resend", 200, { ok: true }, { outcome: "ok" }],
  ["code_resend", 429, { error: "daily" }, { outcome: "refused", reason: "daily_cap" }],
  ["verify", 200, { proof: "abc" }, { outcome: "ok" }],
  ["verify", 200, {}, { outcome: "failed", reason: "unavailable" }],
  ["verify", 400, { error: "wrong_code", attemptsLeft: 2 }, { outcome: "failed", reason: "wrong_code" }],
  ["verify", 400, { errors: ["bad"] }, { outcome: "failed", reason: "invalid" }],
  ["verify", 410, { error: "locked" }, { outcome: "failed", reason: "locked" }],
  ["verify", 410, { error: "expired" }, { outcome: "failed", reason: "expired" }],
  ["verify", 429, null, { outcome: "failed", reason: "rate_limited" }],
  ["verify", 503, null, { outcome: "failed", reason: "unavailable" }],
  ["verify", "network", undefined, { outcome: "failed", reason: "network" }],
  ["submit", 201, { ok: true }, { outcome: "accepted" }],
  ["submit", 200, { ok: true }, { outcome: "refused", reason: "unavailable" }],
  ["submit", 400, { errors: ["x"] }, { outcome: "refused", reason: "invalid" }],
  ["submit", 403, { error: "not_verified" }, { outcome: "refused", reason: "lapsed" }],
  ["submit", 413, null, { outcome: "refused", reason: "too_large" }],
  ["submit", 429, null, { outcome: "refused", reason: "rate_limited" }],
  ["submit", 503, null, { outcome: "refused", reason: "unavailable" }],
  ["submit", "network", undefined, { outcome: "refused", reason: "network" }],
];
for (const [step, status, payload, want] of cases) {
  const got = outcomeOf(step, status, payload);
  check(`outcomeOf(${step}, ${status}) = ${want.outcome}/${want.reason ?? "-"}`, same(got, want));
}

// --- stepProps: labels and a duration, nothing else -------------------------
const accepted: StepResult = { outcome: "accepted" };
check("opened carries only its step", JSON.stringify(stepProps("opened")) === '{"step":"opened"}');
check("no reason key when there is no reason", !("reason" in stepProps("next", { outcome: "ok" })));
check("reason rides along when there is one", stepProps("verify", { outcome: "failed", reason: "locked" }).reason === "locked");
check("ms rides on an accepted submit", stepProps("submit", accepted, 90_000).ms === 90_000);
check("ms is clamped to a day", stepProps("submit", accepted, MAX_FINISH_MS * 3).ms === MAX_FINISH_MS);
check("negative ms clamps to zero", stepProps("submit", accepted, -5).ms === 0);
check("NaN ms is dropped", !("ms" in stepProps("submit", accepted, Number.NaN)));
check("no ms on a refused submit", !("ms" in stepProps("submit", { outcome: "refused", reason: "invalid" }, 90_000)));
check("no ms on any other step", !("ms" in stepProps("next", { outcome: "ok" }, 90_000)));
const keys = Object.keys(stepProps("submit", { outcome: "refused", reason: "lapsed" }, 1));
check("props are step/outcome/reason only", keys.every((k) => ["step", "outcome", "reason", "ms"].includes(k)));

// --- the pixel never hears about the recipe box -----------------------------
const fired: string[] = [];
const g = globalThis as { window?: unknown };
g.window = { fbq: (_command: string, name: string) => fired.push(name) };
trackPixel("recipe_step", { step: "opened" });
trackPixel("recipe_entry_pressed");
trackPixel("card_shared");
delete g.window;
check("pixel skips recipe_step", !fired.includes("RecipeStep"));
check("pixel skips recipe_entry_pressed", !fired.includes("RecipeEntryPressed"));
check("pixel still fires other events (harness sanity)", fired.includes("CardShared"));

// --- /api/track accepts both names ------------------------------------------
async function beacon(event: string): Promise<number> {
  const response = await trackRoute(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ event, props: { step: "opened" } }),
    }),
  );
  return response.status;
}

(async () => {
  check("/api/track accepts recipe_entry_pressed", (await beacon("recipe_entry_pressed")) === 204);
  check("/api/track accepts recipe_step", (await beacon("recipe_step")) === 204);
  check("/api/track still refuses an unknown event", (await beacon("recipe_stepx")) === 400);

  if (failed > 0) {
    console.error(`\ncheck-recipe-box: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\ncheck-recipe-box: all recipe-box checks pass");
  process.exit(0);
})();
