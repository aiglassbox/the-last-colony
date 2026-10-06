/**
 * Pins the recipe box: the labels the Add Recipe form's beacons carry, and,
 * as its tabs land, the dashboard's arithmetic.
 *
 *   npx tsx scripts/check-recipe-box.ts
 *
 * Model-free and offline, and part of `npm run check`. `DATABASE_URL` and
 * `Last_Colony_DATABASE_URL` are cleared first so the beacon round-trip below can never write a row into a
 * real event log.
 */
import { NextRequest } from "next/server";

import { MAX_FINISH_MS, outcomeOf, stepProps, type AnsweredStep, type StepResult } from "../src/app/add-recipe/track";
import { POST as trackRoute } from "../src/app/api/track/route";
import { UNTRACKED_PATH } from "../src/lib/analytics";
import type { SubmissionRow } from "../src/lib/community/client";
import { bucketOf, HOUR, summariseSubmissions } from "../src/lib/dash/queries/submissions";
import { bucketise, FINISH_EDGES, FINISH_LAST, median, MINUTE, percent, stepPanels } from "../src/lib/dash/queries/recipes";
import type { StepRow } from "../src/lib/dash/types";
import { trackPixel } from "../src/lib/meta-pixel";

delete process.env.DATABASE_URL;
delete process.env.Last_Colony_DATABASE_URL;

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

// --- the dashboard is not in its own numbers --------------------------------
check("UNTRACKED_PATH covers /recipe-box", UNTRACKED_PATH.test("/recipe-box"));
check("UNTRACKED_PATH covers /recipe-box/api/auth", UNTRACKED_PATH.test("/recipe-box/api/auth"));
check("UNTRACKED_PATH leaves /recipe-boxes alone", !UNTRACKED_PATH.test("/recipe-boxes"));
check("UNTRACKED_PATH leaves /add-recipe alone", !UNTRACKED_PATH.test("/add-recipe"));

// --- funnel arithmetic -------------------------------------------------------
const row = (step: string, outcome: string | null, reason: string | null, n: number, devices: number, rollup = false): StepRow => ({
  step,
  outcome,
  reason,
  rollup,
  n,
  devices,
});
const panels = stepPanels([
  row("photo_attached", null, null, 5, 4, true),
  row("photo_read", "ok", null, 3, 3),
  row("photo_read", "unreadable", null, 1, 1),
  row("photo_read", "refused", "rate_limited", 1, 1),
  row("verify", "failed", "wrong_code", 7, 3),
  row("verify", "refused", "wrong_code", 2, 1), // forged outcome spelling, same label: merged
  row("submit", "refused", "lapsed", 2, 2),
  row("submit", "refused", "constructor", 9, 9), // forged reason: dropped
  row("hacked", "refused", "network", 9, 9), // forged step: dropped
  row("back", null, null, 6, 2, true),
  row("code_resend", null, null, 4, 3, true),
  row("next", "invalid", null, 3, 2),
]);
check(
  "photo branch: attached then outcomes in fixed order",
  JSON.stringify(panels.photo.map((p) => [p.label, p.n])) ===
    JSON.stringify([["Attached", 5], ["Read — fields filled", 3], ["Unreadable", 1], ["Not a recipe", 0], ["Refused", 1]]),
);
check("refusals: merged by label, biggest first", panels.refusals[0]?.label === "Verify · wrong code" && panels.refusals[0]?.n === 9);
check("refusals: forged step and reason dropped", panels.refusals.length === 3);
check("secondary: Back from the rollup row", panels.secondary[0]?.n === 6 && panels.secondary[0]?.devices === 2);
check("secondary: Resend from the rollup row", panels.secondary[1]?.n === 4 && panels.secondary[1]?.devices === 3);
check("secondary: absent step is a zero, not a missing row", panels.secondary[2]?.n === 0);
check("secondary: next blocked", panels.secondary[3]?.n === 3 && panels.secondary[3]?.devices === 2);
check("no photo events means no photo bars", stepPanels([]).photo.length === 0);

check("median of nothing is no figure", median([]) === null);
check("median of one", median([3]) === 3);
check("median of four is the mean of the middle two", median([4, 1, 3, 2]) === 2.5);
check("percent with no denominator is no figure", percent(0, 0) === null);
check("percent rounds", percent(1, 3) === 33);

const finish = bucketise([2 * MINUTE - 1, 2 * MINUTE, 31 * MINUTE], FINISH_EDGES, FINISH_LAST);
check("buckets: just under an edge stays below it", finish[0]?.n === 1);
check("buckets: exactly on an edge goes up", finish[1]?.n === 1);
check("buckets: past the last edge lands in the last bucket", finish[4]?.label === FINISH_LAST && finish[4]?.n === 1);
check("buckets: nothing to bucket is no bars", bucketise([], FINISH_EDGES, FINISH_LAST).length === 0);

// --- submission outcomes -----------------------------------------------------
const sub = (over: Partial<SubmissionRow>): SubmissionRow => ({
  status: "green",
  created_at: new Date("2026-10-05T19:00:00Z"), // 00:30 IST on 6 October
  published_at: null,
  overridden: false,
  mode: "manual",
  state: "Maharashtra",
  has_city: false,
  belongs_to: "grandmother",
  language: "",
  tag: "puran poli",
  ...over,
});
const since = new Date("2026-10-01T00:00:00Z");
const previousSince = new Date("2026-09-24T00:00:00Z");
const stats = summariseSubmissions(
  [
    sub({ published_at: new Date("2026-10-05T21:00:00Z"), mode: "image", has_city: true, language: "mr" }),
    sub({ status: "red", published_at: new Date("2026-10-05T21:00:00Z"), state: "Goa", tag: "" }),
    sub({ status: "pending", state: "Goa", belongs_to: "other", language: "xx" }),
    sub({ overridden: true, state: "Karnataka", belongs_to: "mother", tag: "puran poli" }),
    sub({ created_at: new Date("2026-09-25T00:00:00Z") }), // previous window
    sub({ created_at: new Date("2026-09-01T00:00:00Z") }), // before both: ignored
  ],
  since,
  previousSince,
);
check("published only when green", bucketOf(sub({ status: "red", published_at: new Date() })) === "red");
check("submitted counts the window", stats.submitted.now === 4 && stats.submitted.before === 1);
check("buckets partition the window", stats.pending.now + stats.green.now + stats.red.now + stats.published.now === 4);
check("published is its own bucket", stats.published.now === 1 && stats.green.now === 1);
check("days are cut in IST", stats.daily.length === 1 && stats.daily[0]?.day === "2026-10-06");
check("overrides counted", stats.overrides === 1);
check("publish time median in hours", stats.publishMedianHours === 2);
check("states ranked", stats.states[0]?.label === "Goa" && stats.states[0]?.n === 2);
check("city share", stats.withCity === 1);
check("photo vs typed", stats.modes.image === 1 && stats.modes.manual === 3);
check("relation labels from the form's list", stats.relations.some((r) => r.label === "Grandmother" && r.n === 2));
check("language named, unsupported kept as code, blank as not detected",
  stats.languages.some((l) => l.label === "Marathi") &&
  stats.languages.some((l) => l.label === "xx") &&
  stats.languages.some((l) => l.label === "Not detected"));
check("untagged rows are counted, not dropped", stats.dishes.some((d) => d.label === "Untagged" && d.n === 1));
check("versions: one dish, three rows, states distinct and sorted",
  stats.versions.length === 1 &&
  stats.versions[0]?.tag === "puran poli" &&
  stats.versions[0]?.versions === 3 &&
  JSON.stringify(stats.versions[0]?.states) === JSON.stringify(["Goa", "Karnataka", "Maharashtra"]));
check("all-time has no previous window", summariseSubmissions([sub({})], null, null).submitted.before === 0);
check("HOUR is an hour", HOUR === 3_600_000);

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
