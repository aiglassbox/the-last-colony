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
import { namesForeignDish } from "../src/lib/indianization/foreign-dishes";
import { parseIngredientRows } from "../src/lib/model/recipe-beat";
import { dropNarration, stripOpener } from "../src/lib/model/self-reference";
import { parseSwapRows } from "../src/lib/model/swap-rows";
import { checkRate, clientKey, RATE_LIMIT } from "../src/lib/rate-limit";

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

// Who the limiter thinks is calling. A deployment whose proxy does not forward
// the client address puts every reader behind one key, and that key used to
// carry one person's allowance: the thirteenth reader of the day met the
// limiter and the campaign was down with nothing having gone wrong.
const req = (headers: Record<string, string>) =>
  new Request("http://x/api/chat", { method: "POST", headers });

check("the leftmost forwarded address is the caller", clientKey(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
check("x-real-ip is used when there is no forwarded-for", clientKey(req({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
// A header that is present but blank used to yield "" as the key, which is a
// third shared pool nobody declared.
check(
  "a blank forwarded-for falls through rather than keying on empty",
  clientKey(req({ "x-forwarded-for": "  ", "x-real-ip": "9.9.9.9" })),
  "9.9.9.9",
);
check("an unidentifiable caller lands in the shared pool", clientKey(req({})), RATE_LIMIT.sharedKey);

// The shared pool is a pool, not a person, and is sized accordingly.
check("the shared pool is larger than one caller's budget", RATE_LIMIT.sharedMax > RATE_LIMIT.max, true);
let shared = 0;
for (let i = 0; i < RATE_LIMIT.sharedMax + 5; i++) {
  if (checkRate(RATE_LIMIT.sharedKey).ok) shared++;
}
check("the shared pool allows its own budget, not one caller's", shared, RATE_LIMIT.sharedMax);

// --- card copy ------------------------------------------------------------

console.log("Card copy");

// Guards the distinction directly: the word "corpus" is ours to worry about,
// and it has no business on a card about a dish that was never Indian.
const FOREIGN_KINDS: TurnKind[] = ["foreign"];
check("foreign is a kind the card knows", FOREIGN_KINDS.includes("foreign"), true);

// --- indianisation swap rows ----------------------------------------------

console.log("Swap rows");

check(
  "a well-formed line becomes a row",
  parseSwapRows("mozzarella :: fresh paneer :: lower fat"),
  [{ foreign: "mozzarella", indian: "fresh paneer", why: "lower fat" }],
);
check("a line with no swap is dropped", parseSwapRows("just some prose"), []);

// Seen on a live fusion card: every ingredient row came back wearing the
// template's angle brackets, "<fresh coriander> :: 2 tbsp, chopped".
check(
  "the template's brackets come off a real value",
  parseSwapRows("<mozzarella> :: <fresh paneer> :: <more protein>"),
  [{ foreign: "mozzarella", indian: "fresh paneer", why: "more protein" }],
);
check(
  "an unmatched bracket is left alone",
  parseSwapRows("2 > 1 tbsp :: ghee :: richer")[0].foreign,
  "2 > 1 tbsp",
);
check(
  "brackets come off ingredient rows too",
  parseIngredientRows(["<fresh coriander> :: 2 tbsp, chopped :: a final fresh note"]),
  [{ name: "fresh coriander", quantity: "2 tbsp, chopped", why: "a final fresh note" }],
);
check(
  "the format line is not a row",
  parseSwapRows("<foreign part> :: <indian swap> :: <reason>"),
  [],
);

// The fusion regression, as it actually arrived: asked for pasta and pizza, the
// model answered each dish in turn and mapped both bases to the same flatbread,
// down to a different connector in the two phrasings. One component, one row.
const fusion = parseSwapRows(
  [
    "pizza base :: whole-wheat / millet (jowar, bajra, ragi) flatbread base :: whole grain",
    "pasta :: whole-wheat or millet (jowar, bajra, ragi) flatbread base :: whole grain",
    "mozzarella :: fresh low-fat paneer :: more protein",
  ].join("\n"),
);
check("a shared component collapses to one row", fusion.length, 2);
check("and names both foreign parts", fusion[0].foreign, "pizza base, pasta");
check("distinct swaps are left alone", fusion[1].foreign, "mozzarella");
check(
  "the same part twice does not repeat itself",
  parseSwapRows("pasta :: millet base :: whole grain\npasta :: millet base :: whole grain")[0]
    .foreign,
  "pasta",
);

// --- foreign dishes in a query --------------------------------------------

console.log("Foreign dishes");

// The reported failure: this matched the dosa record cleanly, so the turn
// became a restoration and the card came up with an ATTESTED badge and the
// Dhosaka source strip under an invented pizza.
check("a fusion with a corpus dish is caught", namesForeignDish("dosa + pizza fusion"), "pizza");
check("a bare foreign dish is caught", namesForeignDish("pizza"), "pizza");
check("case and punctuation do not matter", namesForeignDish("Dosa + Pizza!"), "pizza");
check("a plural is caught", namesForeignDish("idli tacos"), "taco");
check("a phrase is caught", namesForeignDish("dosa ice cream"), "ice cream");
check("the longest name wins", namesForeignDish("french fries"), "french fries");

// The list names dishes, never components, because the component map is full
// of words an Indian dish is legitimately made of.
check("butter chicken is not foreign", namesForeignDish("butter chicken"), null);
check("bread pakora is not foreign", namesForeignDish("bread pakora"), null);
check("hakka noodles is not on the list", namesForeignDish("hakka noodles"), null);
check("a plain corpus dish is untouched", namesForeignDish("dosa"), null);
check("a substring is not a match", namesForeignDish("pastry"), null);

// A name here suppresses the corpus for the whole query, so an ingredient that
// can stand in front of an Indian dish must never be on the list. Listing
// "oats" took the upma record off the screen for "oats upma", which is an upma
// with the grain swapped and exactly what that record is for.
check("a swapped grain does not hide the dish", namesForeignDish("oats upma"), null);
check("nor on idli", namesForeignDish("oats idli"), null);
check("nor quinoa", namesForeignDish("quinoa khichdi"), null);

// --- conversation openers -------------------------------------------------

console.log("Openers");

check(
  "a bare concession goes",
  stripOpener("You are right. It needs the pizza half back."),
  "It needs the pizza half back.",
);
check("apostrophe form goes", stripOpener("You're right. Bake it."), "Bake it.");
check("good catch goes", stripOpener("Good catch! Bake it."), "Bake it.");
check("two of them go", stripOpener("You are right. Exactly. Bake it."), "Bake it.");
check(
  "a short tail goes with it",
  stripOpener("You are right about that. Bake it."),
  "Bake it.",
);
// The concession that is carrying the answer stays: cutting to the full stop
// would take the sentence with it.
check(
  "a concession with the answer inside it stays",
  stripOpener("You are right that the tamarind is doing the work here."),
  "You are right that the tamarind is doing the work here.",
);
check(
  "a reply that is only a concession stays",
  stripOpener("You are right."),
  "You are right.",
);
check("ordinary prose is untouched", stripOpener("Jaggery browns faster."), "Jaggery browns faster.");

// The second move, which arrived once the first was closed off: the card read
// back to the reader who is looking at it.
check(
  "self-narration goes",
  stripOpener("The previous suggestion focused on the pasta component. Bake it."),
  "Bake it.",
);
check(
  "both moves in one breath go",
  stripOpener("You are right. The previous answer leaned on noodles. Bake it."),
  "Bake it.",
);
check(
  "a sentence about the dish's own past stays",
  stripOpener("The original dish used hand-pounded rice."),
  "The original dish used hand-pounded rice.",
);

// The comma form keeps its sentence, because the answer is inside it.
check(
  "a conceding clause goes, its sentence stays",
  stripOpener("You are right, it needs the pizza half back."),
  "It needs the pizza half back.",
);
check(
  "the opener pass leaves later sentences to dropNarration",
  stripOpener("You are right, it needs both. The earlier answer leaned on noodles."),
  "It needs both. The earlier answer leaned on noodles.",
);

// A trigger word carrying a real sentence is not a concession, and the length
// of its tail is what tells them apart. These are the sentences the cut must
// not take.
check(
  "exactly, doing work",
  stripOpener("Exactly the same ratio works for bajra."),
  "Exactly the same ratio works for bajra.",
);
check(
  "that is right, doing work",
  stripOpener("That is right for a thick batter, thinner for a dosa."),
  "That is right for a thick batter, thinner for a dosa.",
);
check(
  "noted as a verb",
  stripOpener("Noted in the record as a festival sweet, it uses more jaggery."),
  "Noted in the record as a festival sweet, it uses more jaggery.",
);

// --- narration anywhere in the turn ---------------------------------------

console.log("Narration");

check(
  "narration in second place goes",
  dropNarration("It needs both. The earlier answer leaned on noodles."),
  "It needs both. ",
);
check(
  "the reader's own request read back goes",
  dropNarration("Your last request was for a fusion of pizza and pasta. Press the dough thin."),
  "Press the dough thin.",
);
check(
  "what I said before goes",
  dropNarration("Bake it uncovered. I suggested millet noodles earlier."),
  "Bake it uncovered. ",
);
// The half that answers is bolted to the back of the narration, so the seam is
// the pivot and not the full stop.
check(
  "a narration carrying the answer keeps the answer",
  dropNarration(
    "Your last request was for a fusion, so we should move to a layered bake.",
  ),
  "We should move to a layered bake.",
);
check(
  "ordinary prose is untouched by the sentence pass",
  dropNarration("Bake at 180C for 20 minutes. The crust browns last."),
  "Bake at 180C for 20 minutes. The crust browns last.",
);
// The restoration voice says this in earnest, and it is not narration.
check(
  "the dish's own earlier form stays",
  dropNarration("The original dish used hand-pounded rice. It cooks slower."),
  "The original dish used hand-pounded rice. It cooks slower.",
);
check(
  "a reply that is only narration stays rather than emptying",
  dropNarration("The previous answer leaned on noodles."),
  "The previous answer leaned on noodles.",
);
// A decimal is not a sentence end, but the pieces are rejoined verbatim so a
// mis-cut costs nothing.
check(
  "a decimal survives the sentence match",
  dropNarration("Use 1.5 tbsp ghee and 2.5 cups water."),
  "Use 1.5 tbsp ghee and 2.5 cups water.",
);

// Sentences that open on a word from the narration pattern while talking about
// food. None of them describes the exchange, so none of them is cut.
check(
  "a first-person cooking statement stays",
  dropNarration("I would soak the dal overnight for this one."),
  "I would soak the dal overnight for this one.",
);
check(
  "the record's own earlier reading stays",
  dropNarration("The earlier reading of that verse gives cowpea, not urad."),
  "The earlier reading of that verse gives cowpea, not urad.",
);
check(
  "a question read back is not narration when it is the answer",
  dropNarration("Your request for less heat is easy: drop the chilli to half."),
  "Your request for less heat is easy: drop the chilli to half.",
);
check(
  "a word that only looks like one stays",
  stripOpener("Indeed millets need more water than rice does."),
  "Indeed millets need more water than rice does.",
);

// --- report ---------------------------------------------------------------

if (failures) {
  console.error(`\n✗ ${failures} of ${checks} routing checks failed\n`);
  process.exit(1);
}
console.log(`\n${checks}/${checks} routing checks pass\n`);
