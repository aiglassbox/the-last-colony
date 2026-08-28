/**
 * Pins the semantic-candidate promotion guard against the blast-radius sweep.
 *
 *   npm run corpus:check-promotion
 *
 * A live sweep (33 queries, en/mr/hi) found the model promoting a nearest
 * vector neighbour as the dish the user named — "thalipeeth" → Vilepī (rice
 * gruel), "thecha" → Takra (buttermilk) — a confident wrong ancestor every
 * time. `mayPromoteCandidate` is the deterministic guard: a candidate is only
 * the dish when its name shares a token with the query. These are the exact
 * pairs the sweep surfaced, split into the wrong ones the guard must reject and
 * the correct ones it must keep. Model-free and offline, so it runs in `check`.
 *
 * WRONG here is the campaign risk (a wrong ancestor under a badge); a rejected
 * real match is only a miss. So a false→true regression is far worse than the
 * reverse, and both fail the harness.
 */
import { mayPromoteCandidate } from "../src/lib/retrieval/promote";

type Cand = { dish_name_modern: string; dish_name_source: string | null; aliases: string[] };

interface Case {
  q: string;
  candidate: Cand;
  /** true = the candidate genuinely is the dish and may be promoted. */
  expect: boolean;
  why?: string;
}

const cand = (dish_name_modern: string, dish_name_source: string | null, aliases: string[] = []): Cand => ({
  dish_name_modern,
  dish_name_source,
  aliases,
});

const CASES: Case[] = [
  // --- Wrong ancestors the sweep caught — the guard MUST reject these. --------
  { q: "thalipeeth", candidate: cand("Thick rice gruel / porridge", "Vilepī"), expect: false },
  { q: "thalipeeth", candidate: cand("Rice-and-pulse porridge (khichdi)", "kṛsarā / khicaḍī"), expect: false },
  { q: "thecha", candidate: cand("Spiced buttermilk", "Takra"), expect: false },
  { q: "zunka", candidate: cand("Fermented sour gruel", "Dhanyamla (Kanjika)"), expect: false },
  // Marathi/Hindi normalise to the same English dish name, so the guard decision
  // is language-invariant — the sweep saw the wrong promote in all three.
  { q: "thalipeeth recipe", candidate: cand("Thick rice gruel / porridge", "Vilepī"), expect: false },

  // --- Correct matches the sweep kept — the guard MUST keep these. ------------
  { q: "parpata", candidate: cand("Papad / thin fried wafer", "Parpata"), expect: true },
  { q: "vilepi", candidate: cand("Thick rice gruel / porridge", "Vilepī"), expect: true },
  { q: "gharika", candidate: cand("Fried gram-flour ring (early vada)", "Gharika"), expect: true },
  { q: "panaka", candidate: cand("Panaka (sweet drink)", "panaka"), expect: true },
  { q: "kadalikanda", candidate: cand("Banana Rhizome in Ghee and Spices", "Kadalikanda"), expect: true },

  // --- Guard sanity ----------------------------------------------------------
  // Overlap on the English modern name, not just the transliteration, still promotes.
  { q: "banana rhizome", candidate: cand("Banana Rhizome in Ghee and Spices", "Kadalikanda"), expect: true },
  { q: "snake gourd", candidate: cand("Snake Gourd in Ghee", "Patola"), expect: true },
  // Phonetic fold bridges spelling variance: modak/modaka, vilepi/Vilepī.
  { q: "ukdiche modak", candidate: cand("Ukadiche Modak", "Modaka", ["modak"]), expect: true },
  // An empty or all-stopword query can promote nothing.
  { q: "", candidate: cand("Anything", "Anything"), expect: false },
  { q: "recipe please", candidate: cand("Thick rice gruel", "Vilepī"), expect: false },

  // --- Known residual (pinned, not desired) ----------------------------------
  // "sol kadhi" is a kokum drink; the candidate is besan dumplings in kadhi.
  // They share only the generic word "kadhi", which any-token overlap accepts.
  // Documented ceiling in promote.ts — pinned so a future tightening flips this
  // to `false` deliberately rather than by accident.
  {
    q: "sol kadhi",
    candidate: cand("Gram-flour fritter (besan vada)", "Vesanavatika / Phulauri", ["kadhi vada"]),
    expect: true,
    why: "residual: shared generic 'kadhi' passes any-token overlap",
  },
];

let pass = 0;
const fails: Array<{ c: Case; got: boolean }> = [];

for (const c of CASES) {
  const got = mayPromoteCandidate(c.q, c.candidate);
  if (got === c.expect) pass++;
  else fails.push({ c, got });
}

console.log(`\n${pass}/${CASES.length} promotion-guard cases pass\n`);

if (fails.length) {
  console.error(`  FAIL (${fails.length}):`);
  for (const { c, got } of fails) {
    const kind = c.expect ? "dropped a real match (miss)" : "PROMOTED A WRONG ANCESTOR";
    console.error(
      `    "${c.q}" vs ${c.candidate.dish_name_source ?? c.candidate.dish_name_modern} ` +
        `→ expected ${c.expect}, got ${got}  [${kind}]`,
    );
  }
  console.error(
    "\n✗ A promoted wrong ancestor is the campaign risk this guard exists to close.\n",
  );
  process.exit(1);
}

console.log("✓ promotion guard is clean\n");
