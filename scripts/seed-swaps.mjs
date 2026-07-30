/**
 * Writes the seed swap corpus. Kept as a script rather than nine hand-written
 * files so the shape stays uniform — run once, edit the JSON afterwards.
 *
 *   node scripts/seed-swaps.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "corpus", "swaps");
mkdirSync(DIR, { recursive: true });

const swaps = [
  {
    id: "swap-refined-sugar",
    modern_item: "refined sugar",
    aliases: ["sugar", "white sugar", "cheeni", "chini", "शक्कर", "चीनी", "caster sugar"],
    options: [
      {
        swap: "Jaggery (gur)",
        ratio: "1 cup sugar → 3/4 cup grated jaggery. Dissolve it separately and add off the heat, or it will split milk.",
        taste_and_texture:
          "Darker colour, a mineral edge, and a faint smokiness. In a pale dish it will look wrong — in kheer, halwa or a laddu it looks like it should.",
        nutritional_rationale:
          "Carries an iron and mineral fraction that refining removes. Comparable on total sugars — this is not a sugar-reduction swap.",
      },
      {
        swap: "Palm jaggery or date paste",
        ratio: "1 cup sugar → 3/4 cup palm jaggery, or 1 cup soft date paste (reduce the liquid in the recipe by a third).",
        taste_and_texture:
          "Palm jaggery is more caramel and less grassy than cane gur. Date paste browns fast and can catch — it is the worse swap for anything that goes on a hot griddle.",
        nutritional_rationale: "Adds fibre in the date version; potassium in the palm version.",
      },
    ],
    where_it_went:
      "Industrial refining and a colonial sugar trade made uniform white sugar cheap and aspirational; jaggery became the rural, second-choice option.",
  },
  {
    id: "swap-maida",
    modern_item: "refined wheat flour",
    aliases: ["maida", "all purpose flour", "plain flour", "मैदा"],
    options: [
      {
        swap: "Stone-ground whole wheat, freshly milled",
        ratio: "1 cup maida → 1 cup atta plus 2 tbsp extra water. Rest the dough 20 minutes longer.",
        taste_and_texture:
          "Denser, less stretchy, tears rather than folds. Bad for anything that needs to be laminated or paper-thin; fine for everyday breads.",
        nutritional_rationale: "Fibre up, and the germ carries fat-soluble vitamins the mill removes.",
      },
      {
        swap: "Pearl millet (bajra), finger millet (ragi) or sorghum (jowar)",
        ratio: "Start at 1 cup maida → 3/4 cup millet flour plus 1/4 cup whole wheat. Pure millet flour has no gluten and will not roll without practice.",
        taste_and_texture:
          "Earthy, sometimes bitter with bajra. Cracks at the edge when rolled. Honestly harder to work with — this is a swap that costs you something.",
        nutritional_rationale:
          "Ragi is notably higher in calcium; bajra and jowar higher in iron and fibre than refined wheat. Lower glycaemic load.",
      },
    ],
    where_it_went:
      "Roller mills separated bran and germ cheaply, giving flour a long shelf life; post-Independence procurement centred on wheat, and millets left the supply chain.",
  },
  {
    id: "swap-polished-rice",
    modern_item: "polished white rice",
    aliases: ["white rice", "rice", "basmati", "sona masoori", "चावल", "अरिसि"],
    options: [
      {
        swap: "Hand-pounded or single-polished rice",
        ratio: "1:1 by volume, but 1.5× the water and roughly 10 minutes longer.",
        taste_and_texture:
          "Reddish, chewier, tastes of grain. It does not go fluffy — if you want separate white grains this is the wrong swap.",
        nutritional_rationale: "Fibre and B vitamins up; glycaemic load down.",
      },
      {
        swap: "Millets — foxtail, little, barnyard, kodo",
        ratio: "1 cup rice → 1 cup millet, 2.5 cups water. Soak 30 minutes first or it stays hard in the middle.",
        taste_and_texture:
          "Nuttier and grainier. Goes gluey if overcooked, which is easier to do than with rice.",
        nutritional_rationale: "Higher fibre and, in most millets, more iron. Lower glycaemic load.",
      },
    ],
    where_it_went:
      "Mechanised milling stripped bran and germ at scale from the late 19th century; post-Independence procurement and the public distribution system locked polished rice in as the default grain.",
  },
  {
    id: "swap-rava",
    modern_item: "rava",
    aliases: ["semolina", "sooji", "suji", "रवा", "सूजी"],
    options: [
      {
        swap: "Millet rava (broken foxtail or barnyard millet)",
        ratio: "1 cup rava → 1 cup millet rava, but 3 cups water instead of 2, and a longer dry roast.",
        taste_and_texture: "Nuttier, holds its shape, will not go to the soft paste rava gives. Some people read that as dry.",
        nutritional_rationale: "Fibre and iron up, glycaemic load down.",
      },
      {
        swap: "Cracked whole wheat (dalia / lapsi)",
        ratio: "1:1, with 2.5 parts water and 5 minutes more cooking.",
        taste_and_texture: "Chewier and heavier. Closer to rava than millet is, so it is the easier first step.",
        nutritional_rationale: "Fibre up; keeps the germ that the semolina mill removes.",
      },
    ],
    where_it_went:
      "Rava is a roller-mill product — coarse endosperm separated from bran and germ. It became universal because industrial milling made it cheap and it cooks in four minutes.",
  },
  {
    id: "swap-refined-oil",
    modern_item: "refined seed oil",
    aliases: [
      "refined oil",
      "sunflower oil",
      "soybean oil",
      "vegetable oil",
      "cooking oil",
      "rice bran oil",
      "तेल",
      "blended oil",
    ],
    options: [
      {
        swap: "The named cold-pressed oil of the region the dish comes from",
        ratio: "1:1. Mustard for the east and north, sesame (gingelly) for the south-east, coconut for the south-west, groundnut for the west.",
        taste_and_texture:
          "These oils taste of something, which is the point and also the problem — mustard oil in a south Indian tempering is simply wrong. Match the oil to the dish's region, not to a general rule.",
        nutritional_rationale:
          "Cold pressing keeps the fatty-acid profile and minor compounds that high-heat refining and deodorising strip. Comparable in calories — this is a fat-quality swap, not a fat-reduction one.",
      },
      {
        swap: "Ghee",
        ratio: "1:1 for tempering and shallow frying. Poor choice for deep frying at volume on cost grounds.",
        taste_and_texture: "Richer, browns faster, will burn sooner than a refined oil.",
        nutritional_rationale:
          "Higher in saturated fat than a seed oil — better on flavour and heat stability, worse on that axis. Say both.",
      },
    ],
    where_it_went:
      "Solvent extraction and refining from the mid-20th century produced a cheap, neutral, long-shelf-life oil with a high smoke point; the regional pressed oils became specialty goods.",
  },
  {
    id: "swap-cornflour",
    modern_item: "cornflour",
    aliases: ["corn flour", "corn starch", "cornstarch", "मक्के का आटा"],
    options: [
      {
        swap: "Chana flour (besan)",
        ratio: "1 tbsp cornflour → 1.5 tbsp besan, cooked out for 2 minutes so it loses the raw taste.",
        taste_and_texture: "Cloudy rather than glossy, and it tastes of gram. Wrong for a clear sauce, good for a gravy.",
        nutritional_rationale: "Protein and fibre up; cornflour is close to pure starch.",
      },
      {
        swap: "Rice flour",
        ratio: "1 tbsp cornflour → 1.5 tbsp rice flour as a slurry.",
        taste_and_texture: "Sets softer and slightly grainy, and it thins again on reheating. Nearer to cornflour than besan is.",
        nutritional_rationale: "Comparable on starch. This is a substitution for availability, not for nutrition — say so.",
      },
    ],
    where_it_went:
      "Cornflour arrived with industrial food processing and restaurant cooking as a cheap, neutral, glossy thickener; ground pulses and rice flour had done the job before.",
  },
  {
    id: "swap-instant-yeast",
    modern_item: "instant yeast",
    aliases: ["dry yeast", "active dry yeast", "baking yeast", "यीस्ट"],
    options: [
      {
        swap: "Wild fermentation — the batter or dough's own yeasts and bacteria",
        ratio: "No 1:1. Replace 2 tsp yeast with 8–12 hours at 28–32°C, or a 1/4 cup mature starter.",
        taste_and_texture: "Sourer, more complex, and much less predictable. It will fail on a cold night. That is the trade.",
        nutritional_rationale:
          "Long fermentation breaks down phytates, which improves mineral availability from the grain. Slower is doing the work, not the organism.",
      },
      {
        swap: "Curd or buttermilk as a starter",
        ratio: "2 tbsp thick curd per cup of batter, left 6–8 hours warm.",
        taste_and_texture: "Reliably tangy, faster than a pure wild ferment, less lift.",
        nutritional_rationale: "Same phytate-reduction benefit at a shorter fermentation.",
      },
    ],
    where_it_went:
      "Commercial yeast made leavening fast and repeatable, which is exactly what bakeries and packaged bread needed; the ambient overnight ferment became a weekend project.",
  },
  {
    id: "swap-iodised-salt",
    modern_item: "iodised salt",
    aliases: ["table salt", "namak", "नमक", "iodized salt"],
    options: [
      {
        swap: "Rock salt (sendha namak) — in fermented batters only",
        ratio: "1:1, added before fermentation.",
        taste_and_texture: "No real difference in taste; the batter simply rises more reliably.",
        nutritional_rationale:
          "This swap is about fermentation behaviour, not nutrition. Iodised salt is a public-health measure that works — do not swap it out across your whole kitchen on the strength of an idli batter.",
      },
    ],
    where_it_went:
      "Universal salt iodisation was introduced deliberately to address iodine deficiency. It is one of the modern substitutions this project is not arguing against.",
  },
];

for (const s of swaps) {
  writeFileSync(join(DIR, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
}
console.log(`wrote ${swaps.length} swap records to corpus/swaps/`);
