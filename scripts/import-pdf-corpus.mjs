/**
 * Imports the editorial extraction in "Recipes — Before British" into the
 * Part 3 schema.
 *
 *   node scripts/import-pdf-corpus.mjs
 *
 * Kept as a script rather than eighteen hand-written files so the ancient
 * record and its modern counterpart stay structurally in step — the diff is
 * the product, and the two halves drifting apart is the failure that shows up
 * as a half-empty card.
 *
 * Rules held to while transcribing:
 *  - Only records where the extraction supplies a located, rendered passage
 *    are marked ATTESTED. Everything else is RECONSTRUCTED or INFERRED.
 *  - The Ayurvedic claims in the source ("cures vata") are NOT carried over.
 *    This project makes comparative nutrition claims and no medical ones.
 *  - Contested points in the extraction are carried over verbatim in substance;
 *    they are the most valuable part of it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ANCIENT = join(process.cwd(), "corpus", "ancient");
const MODERN = join(process.cwd(), "corpus", "modern");

const EXTRACTION = "Vitalife editorial extraction — “Recipes: Before British”";
const CHECKED_ON = "2026-07-30";

const verified = (note) => ({
  status: "editor_verified",
  checked_by: EXTRACTION,
  checked_on: CHECKED_ON,
  note,
});


/** Modern counterpart records are uniform — only the ingredient list differs. */
function counterpart({ id, slug, name, ingredients, method, region }) {
  return {
    id,
    slug,
    dish_name_modern: name,
    dish_name_source: null,
    aliases: [],
    share_verdict: null,
    tier: "modern",
    source: {
      text: "Contemporary household and commercial practice",
      author: null,
      century: "20th–21st CE",
      locus: null,
      edition: null,
      page: null,
    },
    original_text: null,
    transliteration: null,
    translation: null,
    ingredients,
    method_reconstructed: method,
    provenance_class: "MODERN_DISH",
    confidence: { identification: 1, ingredients: 0.9, method: 0.9 },
    contested_points: [],
    modern_counterpart_id: null,
    substitution_story: null,
    restore_today: null,
    region,
    season: null,
    vitalife_relevance: "none",
    verification: verified(
      "Modern counterpart record. Describes current practice and makes no claim about any historical text, so there is nothing to verify against an edition.",
    ),
  };
}

const ing = (name, sanskrit, qty, fn) => ({
  name,
  sanskrit,
  quantity_source: null,
  quantity_modern: qty,
  function: fn,
});

const records = [];

// ---------------------------------------------------------------- UPMA -----
records.push({
  id: "arisi-upma-001",
  slug: "upma",
  dish_name_modern: "Upma",
  dish_name_source: "Arisi upma / Uppittu",
  aliases: ["uppuma", "uppittu", "arisi upma", "akki tari uppittu", "उपमा", "உப்புமா"],
  share_verdict: "Upma wasn't born from rava. It simply learned to wear it.",
  tier: "ancient",
  source: {
    text: "Regional culinary archives and Dravidian culinary lexicography (Uppittu / Uppuma)",
    author: null,
    century: "Pre-20th CE",
    locus: null,
    edition: null,
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation: null,
  ingredients: [
    ing("broken rice, coarsely stone-ground", "arisi", "1 cup", "the base grain. Soaked, air-dried and ground coarse on a sil-batta into a fibre-rich rice rava — wheat semolina was practically absent from South Indian kitchens"),
    ing("millets or cracked wheat, regionally", null, "as available", "the same dish took whatever grain the local fields grew; there was no single correct base"),
    ing("black pepper", "marica", "1 tsp", "the heat. Chilli is a Columbian-exchange arrival"),
    ing("ginger", "ārdraka", "1 inch", "aromatic and digestive"),
    ing("mustard seed, urad dal, chana dal, curry leaf", null, "1 tsp each", "the tempering"),
    ing("sesame oil or ghee", "taila", "2 tbsp", "the cooking fat"),
  ],
  method_reconstructed: [
    "Soak the rice, air-dry it, and grind it coarse on a stone mortar. This is the step the dish is named around.",
    "Dry-roast the grain until it smells nutty.",
    "Temper mustard, urad dal, chana dal and curry leaf in sesame oil or ghee; add ginger and cracked pepper.",
    "Pour in hot water and rain the grain in, stirring.",
    "Cover and cook until the grain is soft but still grainy — it was never meant to be fluffy.",
  ],
  provenance_class: "RECONSTRUCTED",
  confidence: { identification: 0.85, ingredients: 0.8, method: 0.7 },
  contested_points: [
    "Upma itself predates British rule; what the colonial period changed was the grain it was made from, not the existence of the dish.",
    "There was no single pre-colonial upma — broken rice, coarse rice, millets and cracked wheat all appear, depending on the region.",
  ],
  modern_counterpart_id: "modern-upma-001",
  substitution_story: {
    changed: [
      {
        from: "broken rice, millets or cracked wheat, ground at home",
        to: "industrially milled wheat semolina (rava)",
        period: "1942 onward, accelerating post-1945",
        driver:
          "the Japanese occupation of Burma in 1942 cut India's main external rice supply, and the colonial administration placed strict controls on domestic rice distribution while exporting stockpiles to feed Allied troops. Semolina — the cracked endosperm left over from milling wheat into maida at northern roller mills — was pushed into the South Indian market as \"Bombay Rava\", with state-subsidised cooking demonstrations and flyers claiming it was more nutritious than rice",
      },
      {
        from: "black pepper and ginger",
        to: "green and red chilli",
        period: "post-Columbian",
        driver: "chilli arrived with Portuguese trade and displaced pepper as everyday heat",
      },
      {
        from: "sesame oil or ghee",
        to: "refined vegetable oil",
        period: "mid-to-late 20th century",
        driver: "solvent extraction produced a cheap, neutral, long-shelf-life oil",
      },
    ],
    nutrition_delta: { fibre: "down", glycaemic_load: "up", protein: "down", iron: "down" },
  },
  restore_today: {
    ingredients: [
      "1 cup broken rice, millet rava (foxtail or barnyard), or cracked wheat",
      "2 tbsp cold-pressed sesame oil or ghee",
      "1 tsp mustard seed, 1 tbsp urad dal, 1 tbsp chana dal, a sprig of curry leaves",
      "1 tsp black pepper, cracked; 1 inch ginger",
      "3 cups water, rock salt",
    ],
    steps: [
      "Dry-roast the grain until nutty. Coarse rice and millet both need a longer roast than semolina, and more water.",
      "Temper mustard, both dals and curry leaf in the oil. Add ginger and cracked pepper.",
      "Add three cups hot water and salt.",
      "Rain the grain in with one hand while stirring with the other. Cover, lowest flame, 8–10 minutes.",
      "Grainier and nuttier than the rava version, and it holds its shape instead of going soft.",
      "The tempering carries most of the flavour, so a cold-pressed oil with a character of its own earns its place.",
    ],
    time_min: 30,
  },
  region: "South India",
  season: null,
  vitalife_relevance: "high",
  verification: verified(
    "Transcribed from the editorial extraction, which cites regional culinary archives, Dravidian lexicography, British Raj military logistics and Famine Inquiry Commission records, and MTR's corporate archives. No single verse is claimed, so this is RECONSTRUCTED rather than ATTESTED.",
  ),
});

// ---------------------------------------------------------------- IDLI -----
records.push({
  id: "iddarika-idli-001",
  slug: "idli",
  dish_name_modern: "Idli",
  dish_name_source: "Iḍḍarikā",
  aliases: ["idly", "iddli", "idlee", "इडली", "இட்லி"],
  share_verdict: "Your idli is a rice cake. It did not begin as one.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga (the food chapter)",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation:
    "The split black gram, soaked … the husks [removed] by rubbing with the hands. Then, having ground [them] on the grinding-stone, mixed with seasonings, kneaded many times in a pot, he should set it aside from the hand. The soured black-gram paste he should put into vaṭikās. Covering with others [containing] valla-cores, he should cook it thoroughly. Taking it down, he should scatter powdered pepper on top. Smeared with ghee, he should fumigate it with asafoetida-and-ghee and with cumin. Well-cooled, white, smooth — these are the excellent iḍḍarikās.",
  ingredients: [
    ing("urad dal, split and dehusked", "māṣa", "2 cups, soaked", "the entire batter. Zero rice — the ancient idli is 100% urad, which is why it was dense, soft and custardy rather than light and open"),
    ing("asafoetida water", "hiṅgu", "1/4 tsp in water", "seasoning and digestive, worked into the batter rather than sprinkled on"),
    ing("ginger", "ārdraka", "1 inch", "aromatic"),
    ing("rock salt", "saindhava", "to taste", "seasoning"),
    ing("black pepper, powdered", "marica", "1 tsp", "scattered over after cooking, not mixed in"),
    ing("ghee", "ghṛta", "2 tbsp", "smeared on the cooked cakes, then used with asafoetida and cumin to fumigate them"),
  ],
  method_reconstructed: [
    "Soak split black gram and rub off the husks by hand.",
    "Grind on the grinding-stone, mix in the seasonings, and knead many times in a pot.",
    "Set it aside until the paste has soured — the text is explicit that it is soured before moulding.",
    "Spoon into vaṭikā moulds, cover with other vessels, and cook through.",
    "Take off the heat, scatter powdered pepper over, smear with ghee.",
    "Fumigate with asafoetida-ghee and cumin. Serve well-cooled, white and smooth.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.9, ingredients: 0.9, method: 0.85 },
  contested_points: [
    "The passage describes a soured urad paste, so the batter was fermented — but it says nothing about rice, and the modern 2:1 to 3:1 rice-to-urad batter has no basis in it.",
    "The cakes were served cooled, not hot from the steamer.",
  ],
  modern_counterpart_id: "modern-idli-001",
  substitution_story: {
    changed: [
      {
        from: "100% urad dal",
        to: "65–75% polished rice, with urad reduced to a fermenting agent",
        period: "late colonial through post-Independence",
        driver:
          "polished rice became the cheapest and most available grain in South Indian kitchens; mechanised milling made it keep, and post-Independence procurement and public distribution centred on rice and wheat",
      },
      {
        from: "pepper, asafoetida, ginger and cumin worked through the dish",
        to: "a plain, unseasoned batter with the flavour moved to the accompaniments",
        period: "20th century",
        driver: "the dish became a vehicle for sambar and chutney rather than a seasoned item in its own right",
      },
    ],
    nutrition_delta: { protein: "down", fibre: "down", glycaemic_load: "up", iron: "down" },
  },
  restore_today: {
    ingredients: [
      "2 cups whole urad dal (gota urad), soaked 6 hours",
      "1/4 tsp asafoetida dissolved in 2 tbsp water",
      "1 inch ginger, finely grated",
      "Rock salt",
      "1 tsp black pepper, coarsely powdered",
      "2 tbsp ghee, and a pinch of cumin",
    ],
    steps: [
      "Grind the soaked dal with as little cold water as you can manage, until white and fluffy.",
      "Work in the asafoetida water, ginger and salt. Cover and leave 8–12 hours somewhere warm, until it smells sour.",
      "Fill greased moulds three-quarters full, cover, and steam 12–14 minutes.",
      "Scatter powdered pepper over, smear with ghee, and finish with cumin.",
      "Let them cool before eating — the text is specific about that, and a cooled 100% urad cake is a different thing from a hot rice idli.",
      "Denser and custardy, and it tastes of dal and pepper rather than of nothing.",
    ],
    time_min: 45,
  },
  region: "Deccan",
  season: null,
  vitalife_relevance: "none",
  verification: verified(
    "Passage located and translated in the editorial extraction, dated 1129 CE. The Devanagari has not yet been transcribed into this record, so the source drawer shows the translation and says so.",
  ),
});

// ---------------------------------------------------------------- DOSA -----
records.push({
  id: "dhosaka-dosa-001",
  slug: "dosa",
  dish_name_modern: "Dosa",
  dish_name_source: "Dhosaka",
  aliases: ["dosai", "dhosa", "dose", "masala dosa", "தோசை", "डोसा"],
  share_verdict: "The first dosa had no rice in it at all.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga (the food chapter)",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation:
    "A batter of split chickpea — or of black gram or cowpea — with asafoetida-water, salt and ginger, spread and cooked on an oiled griddle (tāpī).",
  ingredients: [
    ing("split chickpea", "caṇaka", "2 cups, soaked and ground", "the batter. Urad or cowpea are given as alternatives — but not rice, which does not appear at all"),
    ing("asafoetida water", "hiṅgu", "1/4 tsp in water", "seasoning and digestive"),
    ing("ginger", "ārdraka", "1 inch", "aromatic"),
    ing("rock salt", "saindhava", "to taste", "seasoning"),
    ing("oil", "taila", "for the griddle", "the tāpī was oiled; the fat is part of the method, not an afterthought"),
  ],
  method_reconstructed: [
    "Soak and grind the split chickpea to a batter.",
    "Season with asafoetida water, salt and ginger.",
    "Spread on an oiled griddle and cook through.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.85, ingredients: 0.85, method: 0.7 },
  contested_points: [
    "Fermentation is not stated in the passage. The dense, unfermented reading is an inference from what the text does and does not say.",
    "The nearest thing to this on a modern menu is not the dosa but the besan chilla or the adai — both of which are pulse batters with no rice.",
    "The thin, crisp, potato-filled masala dosa is a 20th-century restaurant dish; potato is a Columbian-exchange arrival.",
  ],
  modern_counterpart_id: "modern-dosa-001",
  substitution_story: {
    changed: [
      {
        from: "a pulse batter — chickpea, black gram or cowpea — with no rice",
        to: "roughly 75% polished rice with urad as the minority partner",
        period: "late colonial through post-Independence",
        driver:
          "polished rice was cheaper and more available than pulses, whose acreage had fallen as land moved toward export and cash crops",
      },
      {
        from: "asafoetida, ginger and salt seasoning the batter itself",
        to: "an unseasoned batter, sour from fermentation",
        period: "20th century",
        driver: "the flavour moved out of the batter and into the chutney and sambar served with it",
      },
    ],
    nutrition_delta: { protein: "down", fibre: "down", glycaemic_load: "up" },
  },
  restore_today: {
    ingredients: [
      "2 cups split chickpea (chana dal), soaked 5 hours",
      "1/4 tsp asafoetida in 2 tbsp water",
      "1 inch ginger",
      "Rock salt",
      "Cold-pressed sesame or groundnut oil for the griddle",
    ],
    steps: [
      "Grind the soaked chana dal with enough water to make a pouring batter. No fermentation needed — this one is cooked fresh.",
      "Stir in the asafoetida water, grated ginger and salt.",
      "Spread on a hot, well-oiled tawa. It will not lace or go crisp the way a rice batter does.",
      "Cook until the underside releases, then fold.",
      "Dense, savoury, and tasting of gram and asafoetida. Closer to an adai than to the dosa you know — which is the point.",
      "The griddle oil is doing real work here; a cold-pressed one is the last thing you taste.",
    ],
    time_min: 30,
  },
  region: "Deccan",
  season: null,
  vitalife_relevance: "medium",
  verification: verified(
    "Passage located and rendered in the editorial extraction, dated 1129 CE. Devanagari not yet transcribed into this record.",
  ),
});

// ------------------------------------------------------------- PAYASAM -----
records.push({
  id: "payasa-kheer-001",
  slug: "kheer",
  dish_name_modern: "Kheer",
  dish_name_source: "Pāyasa",
  aliases: ["payasam", "paysam", "payesh", "phirni", "खीर", "पायसम्"],
  share_verdict: "Payasa was barely sweet. You sweetened it yourself, at the table.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga (the food chapter)",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation:
    "Foxtail millet, wild rice or aromatic rice cooked in buffalo milk that has first been reduced. Milky, faintly sweet from the reduction alone; sugar is added at the table, not in the pot.",
  ingredients: [
    ing("foxtail millet", "kaṅgu", "1/3 cup", "the grain. Still fully available today as navane, thinai or kangni — not obsolete, merely displaced"),
    ing("wild rice", "nīvāra", "alternative to the millet", "a gathered wild grain, now essentially absent from Indian kitchens. Hand-pounded red rice is the closest modern stand-in by texture and cooking behaviour"),
    ing("buffalo milk", "kṣīra", "1 litre", "reduced first, then the grain cooked in it. The sweetness of the finished dish comes from this reduction, not from added sugar"),
  ],
  method_reconstructed: [
    "Reduce the buffalo milk first, over a low fire, before any grain goes in.",
    "Cook the millet or wild rice in the reduced milk until thick and lickable.",
    "Serve mid-meal, not as a dessert. Sugar is offered at the table for those who want it.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.85, ingredients: 0.8, method: 0.8 },
  contested_points: [
    "The identity of nīvāra is disputed — Hygroryza aristata (water-grass), wild Oryza rufipogon, and a generic term for self-sown paddy have all been argued. Caraka treats it as a distinct śūka-dhānya. The extraction presents all three and chooses none.",
    "The order matters and is often reversed today: the milk is reduced first, and the grain cooked in it — not the grain cooked and milk added after.",
  ],
  modern_counterpart_id: "modern-kheer-001",
  substitution_story: {
    changed: [
      {
        from: "sweetness from reduced milk alone, with sugar offered at the table",
        to: "sugar or jaggery cooked into the pot, and a great deal more of it",
        period: "colonial era onward",
        driver:
          "industrial sugar refining and a colonial sugar trade made sweetness cheap and uniform, and the dish moved from a mid-meal course to a dessert, where it is expected to be sweet",
      },
      {
        from: "foxtail millet or wild rice",
        to: "polished rice, or broken basmati",
        period: "late 19th century onward",
        driver: "mechanised milling and the collapse of millets out of the grain supply chain",
      },
      {
        from: "long reduction of whole buffalo milk",
        to: "condensed milk or milk powder to shorten the cook",
        period: "mid 20th century onward",
        driver: "dairy processing and packaging; the reduction is the expensive part in time and fuel",
      },
    ],
    nutrition_delta: { glycaemic_load: "up", fibre: "down", iron: "down", calcium: "unchanged" },
  },
  restore_today: {
    ingredients: [
      "1 litre full-fat milk",
      "1/3 cup foxtail millet (navane / thinai), or hand-pounded red rice",
      "Jaggery or sugar — on the table, not in the pot",
    ],
    steps: [
      "Reduce the milk first. Low flame, wide pan, 30–40 minutes, stirring so it does not catch. This is the dish; there is no shortcut.",
      "Add the millet to the reduced milk and cook until thick enough to lick off a spoon.",
      "Serve it mid-meal, and put the jaggery on the table.",
      "It will taste milky and only faintly sweet. That is not an incomplete kheer — that is what payasa was.",
    ],
    time_min: 55,
  },
  region: "Deccan",
  season: null,
  vitalife_relevance: "low",
  verification: verified(
    "Passage located and rendered in the editorial extraction, dated 1129 CE, including the disputed identification of nīvāra. Devanagari not yet transcribed into this record.",
  ),
});

// ---------------------------------------------------------------- SUPA -----
records.push({
  id: "supa-dal-001",
  slug: "dal",
  dish_name_modern: "Dal",
  dish_name_source: "Sūpa",
  aliases: ["tovve", "varan", "toor dal", "dal tadka", "दाल", "पप्पू", "pappu"],
  share_verdict: "Sūpa used seven pulses. Yours uses one.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga (the food chapter)",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation:
    "Pigeon pea, black gram, lentil, cowpea — the cooks should use all of these for making sūpa. They may be cooked split or unsplit, according to taste. Chickpea, cowpea, lentil and mung should be split beforehand by the skilled, for cooking. Pigeon pea should be lightly roasted, then split in the mill. Once properly split and dehusked with the winnower, put cold water in the pot in a quantity equal to the split pulse, and set it on the stove. As it cooks on the fire, pour in hot water. For colour, add a little turmeric powder. Add water again and again until the cooking is complete. Make a powder of rock salt and add it at one-twentieth part. [Judge it] by colour, by sweetness of taste, by aroma, by softness, and by lightness — thus is the correct perfection of pulse-cooking declared. Nispāva beans and the dark pigeon peas are to be kept free of asafoetida. In cooking lentil and black gram, asafoetida water should be added. … While the mung is cooking, put in asafoetida water. Add fine pieces of fresh ginger. Add brinjal, split and fried in oil. Add lotus-rhizome rounds fried in oil, or priyāla seeds, and turn it with the ladle. Again and again add water, little by little. When well done, add powdered black pepper. Take it off, add dry-ginger powder, and stir with the ladle.",
  ingredients: [
    ing("pigeon pea, black gram, lentil, cowpea, chickpea, mung, nispāva", null, "any of seven", "the dish is built on a range of pulses, chosen and prepared differently — pigeon pea lightly roasted before splitting, others split and winnowed"),
    ing("turmeric", "haridrā", "a little", "for colour, explicitly"),
    ing("rock salt", "saindhava", "one-twentieth part", "the text gives an actual proportion, which is rare"),
    ing("asafoetida water", "hiṅgu", "as appropriate", "added for lentil, black gram and mung — and explicitly kept away from nispāva beans and dark pigeon peas"),
    ing("fresh ginger", "ārdraka", "fine pieces", "added during cooking, not as a tempering at the end"),
    ing("brinjal, lotus rhizome, priyāla seeds", null, "fried in oil first", "vegetables pre-fried in oil and turned through the dal — the only place oil appears"),
    ing("black pepper and dry ginger", "marica, śuṇṭhī", "powdered, at the end", "the finish"),
  ],
  method_reconstructed: [
    "Prepare the pulse: roast pigeon pea lightly and split it in the mill; split and winnow the others.",
    "Put cold water in the pot equal in quantity to the split pulse, and set it on the stove.",
    "As it cooks, pour in hot water — again and again, little by little, until done.",
    "Add a little turmeric for colour, and rock salt at one-twentieth part.",
    "Add asafoetida water where the pulse calls for it, and fine pieces of fresh ginger.",
    "Stir through brinjal or lotus rhizome that has been split and fried in oil.",
    "When well done, add powdered black pepper. Take it off, add dry-ginger powder, and stir.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.9, ingredients: 0.9, method: 0.9 },
  contested_points: [
    "The text judges a finished dal by colour, sweetness, aroma, softness and lightness — a five-axis standard with no modern equivalent.",
    "Some versions add pieces of mutton for relish; the passage records this as optional.",
  ],
  modern_counterpart_id: "modern-dal-001",
  substitution_story: {
    changed: [
      {
        from: "seven pulses used across the repertoire, prepared differently by kind",
        to: "toor dal as the near-universal default",
        period: "20th century",
        driver:
          "mill-split dal standardised the supply, and pulse variety collapsed as acreage fell and distribution consolidated around a few kinds",
      },
      {
        from: "an open pot with water added incrementally, judged by eye",
        to: "a pressure cooker with the water added once",
        period: "mid 20th century onward",
        driver: "the pressure cooker made dal fast and repeatable, at the cost of the whole-ish texture the text describes",
      },
      {
        from: "black pepper and dry ginger stirred in at the end, oil only for pre-frying vegetables",
        to: "chilli, and a ghee or oil tadka poured over the top",
        period: "post-Columbian, consolidating in the 20th century",
        driver: "chilli displaced pepper, and the poured tempering became the defining gesture of the dish",
      },
    ],
    nutrition_delta: { protein: "unchanged", fibre: "down", iron: "down", fat_quality: "mixed" },
  },
  restore_today: {
    ingredients: [
      "1 cup mixed pulses — mung, masoor, chana and toor together rather than toor alone",
      "1/2 tsp turmeric",
      "Rock salt, roughly a twentieth of the dry pulse by weight",
      "1/4 tsp asafoetida in water",
      "1 inch ginger in fine pieces, plus 1/2 tsp dry ginger powder",
      "1 small brinjal, split and fried in a little sesame oil",
      "1 tsp black pepper, powdered",
    ],
    steps: [
      "Roast the toor lightly before you start. Rinse and drain everything.",
      "Cold water equal to the pulse, in an open pot, on the flame.",
      "Top up with hot water, a little at a time, as it cooks. Do not walk away and do not use a pressure cooker — the incremental water is what gives the whole-ish texture.",
      "Turmeric for colour, salt at about a twentieth, asafoetida water and fine ginger.",
      "Stir through the fried brinjal.",
      "Finish with powdered black pepper off the heat, then dry ginger.",
      "No poured tadka, no chilli. It tastes of pulse, pepper and asafoetida, and it is lighter than the dal you are used to.",
    ],
    time_min: 60,
  },
  region: "Deccan",
  season: null,
  vitalife_relevance: "medium",
  verification: verified(
    "Passage located and translated in full in the editorial extraction, dated 1129 CE. Devanagari not yet transcribed into this record.",
  ),
});

// -------------------------------------------------------------- BEDHAI -----
records.push({
  id: "bedhai-paratha-001",
  slug: "bedhai",
  dish_name_modern: "Stuffed paratha",
  dish_name_source: "Urad kī Bharmā Roṭī (Bedhai)",
  aliases: ["bedhai", "bedmi", "bedmi roti", "aloo paratha", "urad dal paratha", "बेदई", "बेड़मी"],
  share_verdict: "The stuffing was dal before the potato ever arrived.",
  tier: "ancient",
  source: {
    text: "Pāka Śāstra",
    author: null,
    century: "19th CE",
    locus: "Bhojan varga, p. 169",
    edition: "Pāka Śāstra (Hindi)",
    page: 169,
  },
  original_text:
    "गेहूँ का आटा विधिपूर्वक सानकर उसकी लोई बनावे उस लोई के भीतर उड़द की दाल की पीठी जिसमें तुमने गरम मसाला नमक और अदरख मिलाकर रखी हो उसे भरो फिर सावधानी से बेलकर तवे पर डालो जब तवे पर उतार कर चूल्हे में दूर की आँच से सेको और घी में चुपड़ कर ताजी (उसी समय) घर वालों को खिलाती जाओ। बेढ़ई रुचिकारक, वात नाशक, पुष्टिकारक …",
  transliteration: null,
  translation:
    "Knead wheat flour according to the method and make dough balls. Inside the dough ball, stuff the urad dal paste (pitthi) in which you have premixed garam masala, salt, and ginger. Roll it out carefully and put it on the griddle (tawa). Once it is cooked on the griddle, take it off and roast it on the stove at a distance from the flame. Smear it with ghee and serve it fresh, immediately, to the family members.",
  ingredients: [
    ing("whole wheat flour", "gehū̃ kā āṭā", "2 cups", "the dough. Quantity is not specified in the text"),
    ing("urad dal paste (pitthi)", "uṛad kī dāl kī pīṭhī", "1 cup soaked and ground", "the stuffing, and the reason this is a protein-dense flatbread rather than a starch-on-starch one"),
    ing("garam masala", null, "1 tsp", "premixed into the dal paste, not sprinkled after"),
    ing("ginger", "adrak", "1 inch, grated", "premixed into the stuffing"),
    ing("salt", "namak", "to taste", "premixed into the stuffing"),
    ing("ghee", "ghī", "to finish", "smeared on the cooked bread"),
  ],
  method_reconstructed: [
    "Knead wheat flour and form dough balls.",
    "Stuff each ball with urad dal paste seasoned with garam masala, salt and ginger.",
    "Roll out the stuffed dough carefully.",
    "Cook on a tawa.",
    "Take it off the tawa and roast it directly over distant flames of the choolha.",
    "Smear with ghee and serve hot immediately.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.9, ingredients: 0.85, method: 0.9 },
  contested_points: [
    "Bedhai or bedmi in UP and north India today is commonly deep-fried like a puri. This text explicitly describes a stuffed roti cooked on a tawa and finished over open flame — closer to a stuffed paratha or a rustic roti.",
    "The source text also makes Ayurvedic claims about the dish. This project does not repeat medical claims of any kind, so they are recorded here as part of the text and not as anything else.",
  ],
  modern_counterpart_id: "modern-aloo-paratha-001",
  substitution_story: {
    changed: [
      {
        from: "urad dal paste as the stuffing",
        to: "spiced potato",
        period: "post-16th century, consolidating through the 19th and 20th",
        driver:
          "the potato arrived from the Americas and became the most versatile and cheapest bulk filling available, displacing the pulse fillings that native vegetables and dals had held",
      },
      {
        from: "tawa, then roasted over distant flame, finished with ghee",
        to: "shallow- or deep-fried",
        period: "20th century",
        driver: "frying is faster and more forgiving than the two-stage tawa-and-flame method",
      },
    ],
    nutrition_delta: { protein: "down", fibre: "down", glycaemic_load: "up" },
  },
  restore_today: {
    ingredients: [
      "2 cups whole wheat flour",
      "1 cup urad dal, soaked 4 hours and ground to a thick paste",
      "1 tsp garam masala, 1 inch ginger grated, salt — all mixed into the dal",
      "Ghee to finish",
    ],
    steps: [
      "Knead the flour into a soft dough and rest it 20 minutes.",
      "Grind the soaked urad thick — a paste, not a batter — and mix in garam masala, ginger and salt.",
      "Flatten a dough ball, spoon the pitthi in, seal it, and roll out carefully. This is the step that takes practice; a thick paste tears less than a wet one.",
      "Cook on a hot tawa, both sides.",
      "Lift it off and hold it over the flame at a distance until it puffs.",
      "Smear with ghee and eat it immediately — the text is insistent on that.",
      "Against an aloo paratha it is higher in protein and fibre and lower in starch, and it keeps you full longer.",
    ],
    time_min: 50,
  },
  region: "North India",
  season: null,
  vitalife_relevance: "medium",
  verification: verified(
    "Original Hindi passage, page number and section transcribed from the editorial extraction (Pāka Śāstra, p. 169). The Ayurvedic claims in the source are deliberately not carried into the record's claims.",
  ),
});

// --------------------------------------------------------------- RASAM -----
records.push({
  id: "pepper-rasam-001",
  slug: "rasam",
  dish_name_modern: "Rasam",
  dish_name_source: "Pepper rasam",
  aliases: ["saar", "saaru", "chaaru", "pulusu", "रसम", "ரசம்"],
  share_verdict: "Rasam was pepper. The tomato and the chilli are both guests.",
  tier: "ancient",
  source: {
    text: "Pre-colonial South Indian household practice, as documented in regional culinary history",
    author: null,
    century: "Pre-16th CE",
    locus: null,
    edition: null,
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation: null,
  ingredients: [
    ing("black pepper", "marica", "1 tbsp, freshly crushed", "the heat and the point of the dish"),
    ing("long pepper", "pippalī", "1 tsp", "the other pepper — almost entirely gone from Indian kitchens today"),
    ing("tamarind", "amlikā", "a lime-sized ball", "the sour. There is no tomato in this dish"),
    ing("freshly crushed spices", null, "as needed", "ground for the pot, not bought as a blend"),
    ing("sesame oil or ghee", "taila", "1 tbsp", "the fat"),
  ],
  method_reconstructed: [
    "Crush the peppers and spices fresh, on stone.",
    "Extract tamarind water.",
    "Temper in sesame oil or ghee and simmer.",
  ],
  provenance_class: "RECONSTRUCTED",
  confidence: { identification: 0.75, ingredients: 0.75, method: 0.55 },
  contested_points: [
    "Long pepper (pippalī) is the ingredient most completely lost from this dish; it is not simply less common but effectively absent from everyday cooking.",
    "The dish survives under several regional names — saar, saaru, chaaru, pulusu — which are not all the same preparation.",
  ],
  modern_counterpart_id: "modern-rasam-001",
  substitution_story: {
    changed: [
      {
        from: "black pepper and long pepper as the heat",
        to: "black pepper plus red chilli, with long pepper rarely used at all",
        period: "post-Columbian",
        driver: "chilli arrived with Portuguese trade, grew easily and cost less than pepper",
      },
      {
        from: "tamarind alone as the sour",
        to: "tamarind plus tomato",
        period: "post-16th century",
        driver: "the tomato is a Columbian-exchange arrival and became a cheap, year-round souring and bulking agent",
      },
      {
        from: "spices crushed fresh on stone for each pot",
        to: "factory-ground rasam powder",
        period: "20th century",
        driver: "commercial spice blending made a consistent, shelf-stable powder cheaper than grinding",
      },
    ],
    nutrition_delta: { fat_quality: "mixed", fibre: "unchanged" },
  },
  restore_today: {
    ingredients: [
      "1 tbsp black peppercorns and 1 tsp long pepper (pippali), crushed just before cooking",
      "A lime-sized ball of tamarind, soaked",
      "1 tbsp cold-pressed sesame oil",
      "Cumin, curry leaf, rock salt",
      "No tomato, no chilli",
    ],
    steps: [
      "Crush the peppercorns and long pepper coarsely. Doing this fresh is most of the difference.",
      "Extract the tamarind in warm water and strain.",
      "Temper cumin and curry leaf in sesame oil, pour in the tamarind water, and simmer until the raw edge goes.",
      "Add the crushed pepper at the end so it stays aromatic.",
      "Sharper and more resinous than a tomato rasam, and the heat sits at the back of the throat instead of the front of the tongue.",
    ],
    time_min: 25,
  },
  region: "South India",
  season: null,
  vitalife_relevance: "medium",
  verification: verified(
    "Transcribed from the editorial extraction, which cites regional culinary history rather than a specific manuscript passage. Classed RECONSTRUCTED for that reason — no verse is claimed.",
  ),
});

// -------------------------------------------------------------- TAHIRI -----
records.push({
  id: "kusmanda-tahiri-001",
  slug: "tahiri",
  dish_name_modern: "Tahiri",
  dish_name_source: "Kuṣmāṇḍa rice",
  aliases: ["tahari", "aloo tahari", "mugauri tahiri", "vegetable pulao", "तहरी"],
  share_verdict: "Ash gourd held this dish together before the potato did.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga — the rice and vegetable preparations",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation: null,
  ingredients: [
    ing("ash gourd", "kuṣmāṇḍa", "2 cups, diced", "the main vegetable, indigenous to India — high in water, low in starch"),
    ing("brinjal, bottle gourd, snake gourd, pumpkin, yam", null, "seasonally", "the everyday vegetables of the period, all of which the potato later displaced"),
    ing("rice", "taṇḍula", "1 cup", "the grain, in a supporting rather than dominant role"),
    ing("black pepper and ginger", "marica, ārdraka", "1 tsp / 1 inch", "the heat, pre-chilli"),
    ing("tamarind", "amlikā", "regionally", "the souring agent"),
    ing("sesame oil or ghee", "taila", "2 tbsp", "the cooking fat"),
  ],
  method_reconstructed: [
    "Fry the seasonal vegetables in sesame oil or ghee.",
    "Add rice and water and cook together.",
    "Season with cracked pepper and ginger; sour with tamarind where the region does so.",
  ],
  provenance_class: "RECONSTRUCTED",
  confidence: { identification: 0.7, ingredients: 0.75, method: 0.6 },
  contested_points: [
    "The Mānasollāsa describes numerous rice-and-vegetable preparations rather than one dish called tahiri; mapping the modern name onto them is a convenience, not a continuity claim.",
  ],
  modern_counterpart_id: "modern-tahiri-001",
  substitution_story: {
    changed: [
      {
        from: "ash gourd and other indigenous vegetables — brinjal, bottle gourd, snake gourd, pumpkin, yam",
        to: "potato as the primary bulk vegetable",
        period: "post-16th century",
        driver:
          "the potato arrived from the Americas and proved cheaper, more storable and more filling than the gourds and yams it replaced. It did not add a vegetable to the repertoire so much as take over the role several native ones had held",
      },
      {
        from: "tamarind as the sour, pepper and ginger as the heat",
        to: "tomato and/or curd, red and green chilli",
        period: "post-Columbian",
        driver: "both tomato and chilli are Columbian-exchange arrivals",
      },
      {
        from: "sesame oil or ghee",
        to: "refined vegetable oil",
        period: "mid-to-late 20th century",
        driver: "industrial refining",
      },
    ],
    nutrition_delta: { fibre: "down", glycaemic_load: "up" },
  },
  restore_today: {
    ingredients: [
      "2 cups ash gourd (petha / kumbalanga), diced — or pumpkin, bottle gourd, yam",
      "1 cup hand-pounded or single-polished rice",
      "2 tbsp cold-pressed sesame oil",
      "1 tsp black pepper, 1 inch ginger",
      "Tamarind water, rock salt",
    ],
    steps: [
      "Fry the diced gourd in sesame oil until the edges colour.",
      "Add the rinsed rice and two and a half cups of water.",
      "Season with cracked pepper and ginger, and a little tamarind water.",
      "Cover and cook until the rice is done and the gourd has collapsed into it.",
      "Lighter and wetter than a potato tahiri, with more of the pot tasting of vegetable than of starch.",
    ],
    time_min: 40,
  },
  region: "Deccan / North India",
  season: null,
  vitalife_relevance: "high",
  verification: verified(
    "Transcribed from the editorial extraction, which points at the Mānasollāsa's rice-and-vegetable preparations generally rather than a single passage. Classed RECONSTRUCTED for that reason.",
  ),
});

// --------------------------------------------------------- GULAB JAMUN -----
records.push({
  id: "ksira-sweet-001",
  slug: "gulab-jamun",
  dish_name_modern: "Gulab jamun",
  dish_name_source: "Kṣīra sweet",
  aliases: ["gulabjamun", "gulab jaamun", "chhena murki", "गुलाब जामुन"],
  share_verdict: "Acid-set curd and rice flour. No khoya, no maida.",
  tier: "ancient",
  source: {
    text: "Mānasollāsa",
    author: "Someśvara III",
    century: "1129 CE",
    locus: "Annabhoga (the food chapter)",
    edition: "Gaekwad's Oriental Series",
    page: null,
  },
  original_text: null,
  transliteration: null,
  translation:
    "Milk split with takra-maṇḍa, the curd drained and bound with rice flour, shaped, fried in ghee and soaked in sugar syrup, scented with cardamom.",
  ingredients: [
    ing("milk, split with takra-maṇḍa", "kṣīra, takra-maṇḍa", "2 litres", "takra-maṇḍa is the thin whey drawn off curd — a gentle coagulant. Modern kitchens use lemon juice, vinegar or citric acid, all of which are harsher and genuinely change the curd's texture"),
    ing("rice flour", "taṇḍula-cūrṇa", "1/4 cup", "the binder. Not maida, and not khoya"),
    ing("ghee", "ghṛta", "for frying", "the frying medium"),
    ing("sugar syrup", "śarkarā", "for soaking", "the soak"),
    ing("cardamom", "elā", "4 pods", "the only aromatic — no rose, no saffron"),
  ],
  method_reconstructed: [
    "Split the milk with takra-maṇḍa, the thin whey from the previous day's curd.",
    "Drain the curd and bind it with rice flour.",
    "Shape, fry in ghee, and soak in cardamom sugar syrup.",
  ],
  provenance_class: "ATTESTED",
  confidence: { identification: 0.8, ingredients: 0.85, method: 0.8 },
  contested_points: [
    "The coagulant is the ingredient worth actually testing: takra-maṇḍa gives a softer, grainier curd than lemon or vinegar, and the texture difference is real rather than nominal.",
    "The result is grainy-soft and faintly lactic, not the melting-soft khoya jamun of today; chhena murki is arguably the closer living relative.",
  ],
  modern_counterpart_id: "modern-gulab-jamun-001",
  substitution_story: {
    changed: [
      {
        from: "acid-set milk curd bound with rice flour",
        to: "khoya bound with maida",
        period: "colonial era onward",
        driver:
          "roller-milled refined flour and commercially reduced khoya both became cheap and standard, and they give the melting texture the modern sweet is judged on",
      },
      {
        from: "takra-maṇḍa (whey) as the coagulant",
        to: "lemon juice, vinegar or citric acid",
        period: "20th century",
        driver: "faster and more reliable, and available off a shelf — but harsher on the curd",
      },
      {
        from: "cardamom alone, eaten within the meal",
        to: "cardamom, rose and saffron, eaten as dessert",
        period: "Mughal era onward",
        driver: "rosewater and saffron entered the sweet repertoire, and the course moved to the end of the meal",
      },
    ],
    nutrition_delta: { protein: "up", glycaemic_load: "down", fibre: "unchanged" },
  },
  restore_today: {
    ingredients: [
      "2 litres full-fat milk",
      "1 cup thin whey from yesterday's curd (or well-diluted buttermilk) as the coagulant",
      "1/4 cup rice flour",
      "Ghee for frying",
      "Sugar syrup with 4 cardamom pods — no rose, no saffron",
    ],
    steps: [
      "Heat the milk and split it with the whey rather than lemon. It curdles more slowly and the curd comes out softer.",
      "Drain in a cloth, then knead with rice flour until it binds.",
      "Shape small, fry gently in ghee — hot fat will crack them.",
      "Soak in warm cardamom syrup.",
      "Grainy-soft and faintly lactic rather than melting. Higher in milk protein and lower in refined starch than a khoya-and-maida jamun.",
    ],
    time_min: 70,
  },
  region: "Deccan",
  season: null,
  vitalife_relevance: "low",
  verification: verified(
    "Passage located and rendered in the editorial extraction, dated 1129 CE, including the takra-maṇḍa coagulant note. Devanagari not yet transcribed into this record.",
  ),
});

// --- modern counterparts ---------------------------------------------------

const counterparts = [
  counterpart({
    id: "modern-upma-001",
    slug: "upma-modern",
    name: "Upma (as cooked today)",
    region: "Pan-Indian",
    ingredients: [
      ing("wheat semolina (rava)", null, "1 cup", "the cracked endosperm left over from milling wheat into maida, sold south as \"Bombay Rava\". It cooks in four minutes, which is why it won"),
      ing("green and red chilli", null, "2–3", "the heat, in place of pepper and ginger"),
      ing("refined vegetable oil", null, "2 tbsp", "tempering fat, chosen for price and neutrality"),
      ing("onion, carrot, peas, beans, tomato, potato", null, "to taste", "the modern vegetable set, several of which are post-Columbian arrivals"),
      ing("peanuts and cashews", null, "a handful", "later additions"),
    ],
    method: ["Roast rava, temper, add vegetables, pour in water and stir in the rava."],
  }),
  counterpart({
    id: "modern-idli-001",
    slug: "idli-modern",
    name: "Idli (as cooked today)",
    region: "Pan-Indian",
    ingredients: [
      ing("polished parboiled rice", null, "3 cups", "65–75% of the batter. The ancient dish had none at all"),
      ing("urad dal", null, "1 cup", "reduced from the whole substance of the dish to a fermenting and binding agent"),
      ing("fenugreek seed", null, "1 tsp", "assists fermentation and browning"),
      ing("iodised salt", null, "to taste", "seasoning"),
    ],
    method: ["Soak, grind, ferment 8–12 hours.", "Steam in moulds and serve hot with sambar and chutney."],
  }),
  counterpart({
    id: "modern-dosa-001",
    slug: "dosa-modern",
    name: "Dosa (as cooked today)",
    region: "Pan-Indian",
    ingredients: [
      ing("polished parboiled rice", null, "3 cups", "about 75% of the batter"),
      ing("urad dal", null, "1 cup", "fermentation and binding"),
      ing("salt", null, "to taste", "the only seasoning in the batter; the flavour moved to the chutney"),
      ing("oil or ghee", null, "for the griddle", "griddle fat"),
    ],
    method: ["Ferment a rice-heavy batter 8–12 hours.", "Spread very thin on a hot griddle and crisp."],
  }),
  counterpart({
    id: "modern-kheer-001",
    slug: "kheer-modern",
    name: "Kheer (as made today)",
    region: "Pan-Indian",
    ingredients: [
      ing("rice or millet", null, "1/3 cup", "usually polished rice"),
      ing("milk, or condensed milk", null, "1 litre / 1 tin", "the tin removes the reduction step that made the ancient dish what it was"),
      ing("sugar or jaggery, cooked in", null, "3/4 cup", "sweetness now goes in the pot, not on the table"),
      ing("cardamom, saffron, nuts", null, "to taste", "aromatics and garnish; nuts fried in ghee"),
    ],
    method: ["Cook grain in milk, or add milk to cooked grain.", "Stir sugar in and finish with cardamom and nuts."],
  }),
  counterpart({
    id: "modern-dal-001",
    slug: "dal-modern",
    name: "Dal (as cooked today)",
    region: "Pan-Indian",
    ingredients: [
      ing("toor dal", null, "1 cup", "one pulse where the text used seven"),
      ing("turmeric and salt", null, "to taste", "seasoning"),
      ing("asafoetida powder, ginger, chilli", null, "to taste", "chilli in place of pepper"),
      ing("ghee or oil tadka", null, "2 tbsp, poured over", "the defining modern gesture — the text used oil only to pre-fry vegetables"),
    ],
    method: ["Pressure-cook the dal with turmeric, water added once.", "Pour a tadka over the mashed dal."],
  }),
  counterpart({
    id: "modern-aloo-paratha-001",
    slug: "aloo-paratha-modern",
    name: "Aloo paratha (as cooked today)",
    region: "North India",
    ingredients: [
      ing("wheat flour", null, "2 cups", "the dough"),
      ing("spiced potato", null, "3 boiled and mashed", "the stuffing. A Columbian-exchange arrival that displaced the pulse fillings"),
      ing("green chilli, coriander", null, "to taste", "the modern seasoning"),
      ing("ghee or oil", null, "generous", "shallow-fried rather than tawa-and-flame"),
    ],
    method: ["Stuff dough balls with spiced mashed potato.", "Roll and shallow-fry on a tawa."],
  }),
  counterpart({
    id: "modern-rasam-001",
    slug: "rasam-modern",
    name: "Rasam (as cooked today)",
    region: "South India",
    ingredients: [
      ing("black pepper and red chilli", null, "to taste", "chilli now shares the heat with pepper"),
      ing("tomato", null, "2", "a Columbian-exchange arrival, now a defining ingredient"),
      ing("tamarind", null, "a small ball", "still the base sour, alongside the tomato"),
      ing("factory-ground rasam powder", null, "2 tsp", "in place of spices crushed fresh for each pot"),
      ing("ghee or refined vegetable oil", null, "1 tbsp", "the fat"),
    ],
    method: ["Simmer tamarind and tomato with rasam powder.", "Temper and finish."],
  }),
  counterpart({
    id: "modern-tahiri-001",
    slug: "tahiri-modern",
    name: "Aloo tahari (as cooked today)",
    region: "North India",
    ingredients: [
      ing("potato", null, "3, cubed", "the primary bulk vegetable, introduced after the 16th century"),
      ing("rice", null, "1 cup", "polished"),
      ing("tomato and/or curd", null, "to taste", "the souring agent, in place of tamarind"),
      ing("red and green chilli", null, "to taste", "the heat, in place of pepper and ginger"),
      ing("refined vegetable oil", null, "2 tbsp", "the cooking fat"),
    ],
    method: ["Fry potato and spices, add rice and water, cook as a one-pot."],
  }),
  counterpart({
    id: "modern-gulab-jamun-001",
    slug: "gulab-jamun-modern",
    name: "Gulab jamun (as made today)",
    region: "Pan-Indian",
    ingredients: [
      ing("khoya", null, "250 g", "commercially reduced milk solids, in place of drained acid-set curd"),
      ing("maida", null, "1/4 cup", "roller-milled refined flour, in place of rice flour"),
      ing("ghee", null, "for frying", "the frying medium"),
      ing("sugar syrup with cardamom, rose and saffron", null, "for soaking", "rose and saffron are later arrivals to the dish"),
    ],
    method: ["Bind khoya with maida, shape and fry.", "Soak in scented syrup."],
  }),
];

for (const r of [...records, ...counterparts]) {
  const dir = r.tier === "ancient" ? ANCIENT : MODERN;
  writeFileSync(join(dir, `${r.slug}.json`), JSON.stringify(r, null, 2) + "\n");
}

console.log(
  `wrote ${records.length} ancient records and ${counterparts.length} counterparts from the extraction`,
);
