/**
 * Component-restoration swaps.
 *
 * These are the ones the fallback leans on when a dish is not in the corpus:
 * you cannot restore chicken tikka masala, but you can restore its cream, its
 * thickener and its fat. Ratios are written to be usable, and every entry says
 * out loud which axis it wins on — "healthier" on its own is not a claim this
 * project makes.
 *
 *   node scripts/seed-swaps-components.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "corpus", "swaps");
mkdirSync(DIR, { recursive: true });

const swaps = [
  {
    id: "swap-cream",
    modern_item: "cream",
    aliases: ["malai", "fresh cream", "heavy cream", "amul cream", "मलाई", "क्रीम", "double cream"],
    options: [
      {
        swap: "Thick curd, hung 30 minutes",
        ratio:
          "1/2 cup cream → 3/4 cup thick curd, hung in a cloth for 30 minutes. Take the pan off the heat before it goes in, and stir it through — added to a boiling gravy it will split.",
        taste_and_texture:
          "Tangier and lighter. It will not give you the flat, heavy richness cream does, and in a dish built entirely around that richness you will notice the absence.",
        nutritional_rationale:
          "More protein, substantially less saturated fat per serving. Comparative only.",
      },
      {
        swap: "Soaked and ground kabuli chana paste",
        ratio:
          "1/2 cup cream → 1/3 cup kabuli chana, soaked overnight, boiled soft, ground smooth with a little of its water. Cook it into the gravy for five minutes.",
        taste_and_texture:
          "Gives body rather than richness — a rounder, slightly nutty gravy that coats the same way. It is closer to how a period gravy was actually thickened than cream is.",
        nutritional_rationale: "Protein and fibre both up; saturated fat well down.",
      },
    ],
    where_it_went:
      "Restaurant kitchens standardised on cream because it is fast, stable and forgiving, and the home cook followed the restaurant. Ground pulses and nuts had done the thickening before it.",
  },
  {
    id: "swap-khoya",
    modern_item: "khoya",
    aliases: ["mawa", "khoa", "milk solids", "खोया", "मावा"],
    options: [
      {
        swap: "Drained acid-set curd (chhena), bound with rice flour",
        ratio:
          "1 cup khoya → curd drained from 1.5 litres of milk, kneaded with 2–3 tbsp rice flour. Split the milk with thin whey from yesterday's curd rather than lemon.",
        taste_and_texture:
          "Grainy-soft and faintly lactic instead of melting-soft. This is a real difference in the finished sweet, not a rounding error — the modern texture is the thing you are trading away.",
        nutritional_rationale:
          "More milk protein, less refined starch than a khoya-and-maida sweet.",
      },
      {
        swap: "Milk reduced at home, with ground almond or cashew",
        ratio: "1 cup khoya → 1 litre full-fat milk reduced slowly, plus 2 tbsp ground nuts to bind.",
        taste_and_texture: "Closer to commercial khoya than chhena is, and it takes about 40 minutes of stirring.",
        nutritional_rationale: "Comparable on fat; this swap is about what is in it, not about reducing anything.",
      },
    ],
    where_it_went:
      "Commercially reduced khoya and roller-milled maida became cheap and standard together, and the melting texture they give is now what the sweet is judged on.",
  },
  {
    id: "swap-acid-coagulant",
    modern_item: "lemon juice as a coagulant",
    aliases: ["vinegar", "citric acid", "lemon", "nimbu", "acid for splitting milk", "सिरका"],
    options: [
      {
        swap: "Takra-maṇḍa — the thin whey drawn off the previous day's curd",
        ratio:
          "1 tbsp lemon juice → about 1 cup thin whey, added to hot milk a little at a time until it splits. Well-diluted buttermilk works the same way.",
        taste_and_texture:
          "The curd comes out softer and grainier, and without the sharp edge lemon or vinegar leave behind. The coagulant genuinely changes the texture — this is worth testing rather than taking on trust.",
        nutritional_rationale:
          "Nutritionally close. This swap is about texture and taste, not about any nutritional axis, and it would be dishonest to sell it as one.",
      },
    ],
    where_it_went:
      "Lemon, vinegar and citric acid are faster, more reliable and available off a shelf. Whey has to be saved from yesterday, which is a habit the modern kitchen dropped.",
  },
  {
    id: "swap-potato-bulk",
    modern_item: "potato",
    aliases: ["aloo", "potatoes", "आलू", "batata"],
    options: [
      {
        swap: "White peas or kabuli chana, half of it mashed",
        ratio:
          "2 cups diced potato → 2 cups cooked white peas or kabuli chana, half mashed to hold the dish together and half left whole for texture.",
        taste_and_texture:
          "Holds a mash together nearly as well, with more bite. It will not go silky the way potato does, so it is the wrong swap where silkiness is the point.",
        nutritional_rationale: "Protein and fibre up, glycaemic load down.",
      },
      {
        swap: "Ash gourd, pumpkin, bottle gourd or yam",
        ratio: "1:1 by volume, but cook for less time and use less water — gourds carry a lot of their own.",
        taste_and_texture:
          "Wetter and lighter, and it collapses rather than holding cubes. This is what these dishes used before the potato arrived, so it tastes older rather than worse.",
        nutritional_rationale: "Higher water content, lower starch, more fibre per serving.",
      },
    ],
    where_it_went:
      "The potato arrived from the Americas after the 16th century and proved cheaper, more storable and more filling than the gourds and yams it replaced — taking over a role several indigenous vegetables had held rather than adding a new one.",
  },
  {
    id: "swap-masala-powder",
    modern_item: "ready-made masala powder",
    aliases: [
      "rasam powder",
      "sambar powder",
      "garam masala powder",
      "curry powder",
      "factory masala",
      "मसाला पाउडर",
    ],
    options: [
      {
        swap: "Whole spices crushed fresh for the pot",
        ratio:
          "2 tsp blended powder → roughly 1 tbsp whole spices, crushed coarsely just before cooking. For rasam specifically: black peppercorns with a little long pepper (pippali).",
        taste_and_texture:
          "Sharper and more aromatic, and it fades faster — which is why the blend won. Crushing to order is the whole difference and there is no way around the five minutes it costs.",
        nutritional_rationale:
          "Volatile aromatic compounds degrade with time and grinding heat. This is a flavour swap; do not oversell it as a nutritional one.",
      },
      {
        swap: "Long pepper (pippali) alongside black pepper",
        ratio: "Replace a quarter of the black pepper by weight with long pepper.",
        taste_and_texture:
          "Sweeter, more resinous heat that sits at the back of the throat. Long pepper is the ingredient most completely lost from South Indian cooking, not merely less common.",
        nutritional_rationale: "A flavour restoration, not a nutritional one. Said plainly.",
      },
    ],
    where_it_went:
      "Commercial spice blending produced a consistent, shelf-stable powder cheaper than grinding at home, and the stone went out of the kitchen with it.",
  },
];

for (const s of swaps) {
  writeFileSync(join(DIR, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
}
console.log(`wrote ${swaps.length} component swap records`);
