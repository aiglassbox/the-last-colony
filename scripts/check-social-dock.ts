/**
 * Pins the home screen's social dock: the three links and their order, the
 * slot arithmetic the dock moves by, and the `social_clicked` beacon.
 *
 *   npx tsx scripts/check-social-dock.ts
 *
 * Model-free and offline, and part of `npm run check`. `DATABASE_URL` and
 * `Last_Colony_DATABASE_URL` are cleared first so the beacon round-trip below
 * can never write a row into a real event log.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import { POST as trackRoute } from "../src/app/api/track/route";
import { trackPixel } from "../src/lib/meta-pixel";
import { moveTo, SIZE, slotFor, slotOffset, slotPoint, SOCIALS, SPAN, STEP } from "../src/lib/social";

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

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// --- the links, exactly as the owner gave them ------------------------------
const expected: [string, string, string][] = [
  ["instagram", "Kranti Cookbook on Instagram", "https://www.instagram.com/kranticookbook/"],
  ["youtube", "Kranti Cookbook on YouTube", "https://www.youtube.com/channel/UCOoB6U474PW5jpidGElnJcg"],
  ["x", "Kranti Cookbook on X", "https://x.com/kranticookbook"],
];
// SocialDock.tsx declares one motion-value pair per icon, flat. A fourth icon
// here needs a fourth pair there, and this line is what says so.
check("exactly three icons (SocialDock.tsx declares three motion-value pairs)", SOCIALS.length === 3);
expected.forEach(([network, label, href], i) => {
  const s = SOCIALS[i];
  check(`slot ${i} starts as ${network}`, s?.network === network);
  check(`${network} label`, s?.label === label);
  check(`${network} href`, s?.href === href);
  check(`${network} icon file exists`, !!s && existsSync(join("public", s.icon)));
});

// --- geometry ----------------------------------------------------------------
check("36px icons on a 44px pitch, 124px a row", SIZE === 36 && STEP === 44 && SPAN === 124);
check("the last slot is the corner", slotOffset(2) === 0);
check("the first slot is two steps back from it", slotOffset(0) === -88);
const row0 = slotPoint("row", 0);
const col0 = slotPoint("column", 0);
check("a row runs along x", row0.x === -88 && row0.y === 0);
check("a column runs along y", col0.x === 0 && col0.y === -88);
const rowEnd = slotPoint("row", 2);
const colEnd = slotPoint("column", 2);
check("row and column share the corner slot", rowEnd.x === colEnd.x && rowEnd.y === colEnd.y);

// --- moveTo ------------------------------------------------------------------
check("moveTo: first to last", same(moveTo([0, 1, 2], 0, 2), [1, 2, 0]));
check("moveTo: last to first", same(moveTo([0, 1, 2], 2, 0), [2, 0, 1]));
check("moveTo: to its own slot changes nothing", same(moveTo([0, 1, 2], 1, 1), [0, 1, 2]));
check("moveTo: past the end clamps", same(moveTo([0, 1, 2], 0, 9), [1, 2, 0]));
check("moveTo: before the start clamps", same(moveTo([2, 0, 1], 1, -3), [1, 2, 0]));
let permutation = true;
for (const id of [0, 1, 2]) {
  for (const slot of [-1, 0, 1, 2, 3]) {
    const next = moveTo([2, 0, 1], id, slot);
    if (!same([...next].sort(), [0, 1, 2])) permutation = false;
  }
}
check("moveTo: never loses or doubles an icon", permutation);
check("slotFor: no travel stays", slotFor(0, 0) === 0);
check("slotFor: under half a step stays", slotFor(0, 21) === 0);
check("slotFor: half a step moves", slotFor(0, 22) === 1);
check("slotFor: half a step back stays (round(0.5) is 1)", slotFor(1, -22) === 1);
check("slotFor: past half a step back moves", slotFor(1, -23) === 0);
check("slotFor: clamped high", slotFor(0, 400) === 2);
check("slotFor: clamped low", slotFor(2, -400) === 0);

// --- first-party only --------------------------------------------------------
const fired: string[] = [];
const g = globalThis as { window?: unknown };
g.window = { fbq: (_command: string, name: string) => fired.push(name) };
trackPixel("social_clicked", { network: "x" });
trackPixel("card_shared");
delete g.window;
check("pixel skips social_clicked", !fired.includes("SocialClicked"));
check("pixel still fires other events (harness sanity)", fired.includes("CardShared"));

// --- /api/track accepts the name ----------------------------------------------
async function beacon(event: string): Promise<number> {
  const response = await trackRoute(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({ event, props: { network: "instagram" } }),
    }),
  );
  return response.status;
}

(async () => {
  check("/api/track accepts social_clicked", (await beacon("social_clicked")) === 204);
  check("/api/track still refuses an unknown event", (await beacon("social_clickedx")) === 400);

  if (failed > 0) {
    console.error(`\ncheck-social-dock: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\ncheck-social-dock: all social-dock checks pass");
  process.exit(0);
})();
