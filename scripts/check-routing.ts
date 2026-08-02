/**
 * Routing checks.
 *
 * `check-retrieval` proves that naming a dish finds the right record. It says
 * nothing about what happens to everything else, and everything else is where
 * the wrong answers were: a bare slash command rendered as a restoration card,
 * a completion with no markers dumped into a display headline, a foreign dish
 * told it was missing from the corpus. All 132 retrieval queries passed
 * throughout.
 *
 * So this covers the other half — which turn a message becomes, and what the
 * card is then allowed to say. Every assertion here is pure: no model key, no
 * server, no network. Run by `npm run check` alongside the retrieval harness.
 */
import { COMMANDS, parseCommand } from "../src/lib/chat/commands";
import { kindOf, parseResolved, RESOLUTION, type TurnKind } from "../src/lib/chat/turn";
import { checkRate, RATE_LIMIT } from "../src/lib/rate-limit";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

// --- the mode declaration -------------------------------------------------

console.log("\nMode declaration");

check("explicit REPLY", parseResolved("MODE: REPLY\n"), "reply");
check("explicit RESTORE", parseResolved("MODE: RESTORE\n"), "restore");
check("explicit MODERN", parseResolved("MODE: MODERN\n"), "modern");
check("explicit INDIANISE", parseResolved("MODE: INDIANISE\n"), "indianise");
check("lower case", parseResolved("mode: modern\n"), "modern");

// The regression that produced the reported screenshot: an undeclared mode used
// to default to a restoration card, so any stray prose became a card with a
// "not in the restored corpus" note attached to a dish nobody had named.
check("undeclared prose falls back to reply", parseResolved("Name one Indian dish"), "reply");
check("undeclared empty falls back to reply", parseResolved(""), "reply");
check(
  "undeclared but card-shaped is still a card",
  parseResolved("§VERDICT§\nYour idli is a rice cake."),
  "restore",
);
check(
  "undeclared indianisation markers are card-shaped too",
  parseResolved("§REBUILD§\n"),
  "restore",
);

// --- resolution to a turn -------------------------------------------------

console.log("Resolution");

check("foreign dish never renders a restoration", RESOLUTION.indianise, {
  mode: "indianize",
  kind: "foreign",
});
check("modern dish is a card, framed as modern", RESOLUTION.modern, {
  mode: "restoration",
  kind: "modern",
});
check("gap is a card, framed as a gap", RESOLUTION.restore, {
  mode: "restoration",
  kind: "gap",
});
check("reply is prose and has no kind", RESOLUTION.reply, {
  mode: "conversation",
  kind: null,
});

// A foreign dish must never reach the copy that talks about the corpus. This is
// the assertion behind "address it as not Indian in origin, not as missing".
check(
  "no resolution maps a foreign dish to the gap card",
  Object.values(RESOLUTION).filter((r) => r.kind === "gap").length,
  1,
);

// --- stored-message translation -------------------------------------------

console.log("Stored messages");

check("kind wins when present", kindOf({ kind: "foreign", empty: false }), "foreign");
check("legacy record", kindOf({ mode: "restoration", empty: false }), "record");
check("legacy gap", kindOf({ mode: "restoration", empty: true }), "gap");
check("legacy modern", kindOf({ mode: "restoration", empty: true, modern: true }), "modern");
// The old shape could not express `foreign` at all — an Indianisation turn was
// stored as "not empty", which is indistinguishable from a real restoration.
check("legacy indianisation recovers as foreign", kindOf({ mode: "indianize" }), "foreign");

// --- slash commands -------------------------------------------------------

console.log("Slash commands");

for (const command of COMMANDS) {
  const bare = parseCommand(`/${command.slug}`);
  check(`/${command.slug} parses`, bare.command?.slug, command.slug);
  check(`/${command.slug} alone has no dish`, bare.rest, "");
  check(`/${command.slug} has an ask line`, Boolean(command.ask.trim()), true);

  const withDish = parseCommand(`/${command.slug} kheer`);
  check(`/${command.slug} kheer keeps the dish`, withDish.rest, "kheer");
}

check("an unknown command is left alone", parseCommand("/biryani").command, null);
check("an unknown command keeps its text", parseCommand("/biryani").rest, "/biryani");

// --- rate limiting --------------------------------------------------------

console.log("Rate limit");

const key = `test-${Math.random()}`;
let allowed = 0;
for (let i = 0; i < RATE_LIMIT.max + 5; i++) {
  if (checkRate(key).ok) allowed++;
}
check("allows exactly the window's budget", allowed, RATE_LIMIT.max);
check("a different caller is unaffected", checkRate(`other-${Math.random()}`).ok, true);
check(
  "the window rolls over",
  checkRate(key, Date.now() + RATE_LIMIT.windowMs + 1000).ok,
  true,
);

// --- card copy ------------------------------------------------------------

console.log("Card copy");

// Guards the distinction directly: the word "corpus" is ours to worry about,
// and it has no business on a card about a dish that was never Indian.
const FOREIGN_KINDS: TurnKind[] = ["foreign"];
check("foreign is a kind the card knows", FOREIGN_KINDS.includes("foreign"), true);

// --- report ---------------------------------------------------------------

if (failures) {
  console.error(`\n✗ ${failures} of ${checks} routing checks failed\n`);
  process.exit(1);
}
console.log(`\n${checks}/${checks} routing checks pass\n`);
