/**
 * Seeds the community store with real regional recipes attributed to
 * "Arpit's Agent", so the retrieval path has something to serve.
 *
 *   npm run community:seed             # insert what is missing, moderate, publish
 *   npm run community:seed -- --dry    # print what it would do, touch nothing
 *   npm run community:seed -- --retag  # only if the trio's tags disagree
 *
 * Every read and write is filtered on display_name === "Arpit's Agent". This
 * script cannot touch a reader's submission and never deletes anything.
 *
 * It calls the store and the pipeline directly rather than POSTing to
 * /api/submissions, so the 3-per-5-minute rate limit and the daily ceiling are
 * not involved. Do not "fix" this into an HTTP client.
 *
 * The twelve dishes were each checked against the corpus keyword engine and
 * score 0.00, well under MIN_KEYWORD_SCORE — so every one of them falls
 * through to the community step instead of being answered from corpus/.
 * Entries 1 to 3 are one dish under three state names on purpose: that is the
 * only honest test of the geo rule, and it only works while all three carry
 * the identical recipe_name. The local names (vedmi, holige, obbattu) live in
 * the story for that reason.
 */
import type { Collection } from "mongodb";

import {
  applyVerdict,
  communityDb,
  insertSubmission,
  publishSubmission,
  SUBMISSIONS,
  type SubmissionDoc,
} from "../src/lib/community/client";
import { moderate } from "../src/lib/community/pipeline";
import { validateSubmission } from "../src/lib/community/schema";
import { NO_GEO } from "../src/lib/events/geo";

interface SeedEntry {
  n: number;
  recipe_name: string;
  state: string;
  city: string;
  story: string;
  ingredients: string;
  method: string;
  /** Kept beside the entry, never stored: a submission has no source field. */
  source_url: string;
}

/** Researched from the web; every entry cites the page it was written from. */
const ENTRIES: SeedEntry[] = [
  {
    "n": 1,
    "recipe_name": "Puran poli",
    "state": "Maharashtra",
    "city": "Pune",
    "story": "Puran poli is the centerpiece of festive Maharashtrian cooking around Pune, made for Gudi Padwa, Holi, Ganesh Chaturthi and Diwali. The filling, puran, is chana dal boiled soft and mashed with jaggery, cardamom and nutmeg into a thick paste; the dough is whole wheat flour worked with oil until pliable, rolled around the stuffing and cooked on a tawa with ghee until golden. The distinguishing Pune accompaniment is katachi amti, a thin, tangy, tempered curry made from the strained stock left over from boiling the chana dal for the puran rather than a discarded byproduct. Puran poli is also eaten plain with a ladle of warm ghee or a glass of milk.",
    "ingredients": "1 cup chana dal\n1 cup jaggery, grated\n1/2 tsp cardamom powder\n1/4 tsp nutmeg powder\n2 cups whole wheat flour\n2 tbsp maida (all-purpose flour)\n3 tbsp oil, plus more for kneading\n1/4 tsp turmeric powder\n1/2 tsp salt\nwater, as needed\nghee, for roasting and serving",
    "method": "1. Rinse 1 cup chana dal and pressure cook with 3 cups water for 3-4 whistles until soft enough to mash easily.\n2. Drain the cooked dal well, reserving the stock separately for katachi amti; do not discard it.\n3. Return the drained dal to a pan with 1 cup grated jaggery and cook on low heat, mashing and stirring, until the mixture thickens into a smooth, dry paste that holds its shape.\n4. Stir in 1/2 tsp cardamom powder and 1/4 tsp nutmeg powder, then cool the puran completely and divide into balls slightly smaller than the dough balls.\n5. Knead 2 cups whole wheat flour with 2 tbsp maida, 1/4 tsp turmeric, 1/2 tsp salt, 3 tbsp oil and enough water into a soft, elastic dough; cover and rest at least 30 minutes.\n6. Divide the dough into balls, flatten one, place a puran ball in the centre, and gather the edges up to seal completely.\n7. Dust lightly and roll the stuffed ball out gently into a thin, even round, taking care the filling does not tear through.\n8. Cook on a hot tawa, applying ghee on both sides, until golden-brown spots appear on each side.\n9. Serve warm with a ladle of ghee, with katachi amti made from the reserved dal stock, or with a glass of milk.",
    "source_url": "https://www.vegrecipesofindia.com/puran-poli-recipe-bobbatlu-holige-recipe/"
  },
  {
    "n": 2,
    "recipe_name": "Puran poli",
    "state": "Gujarat",
    "city": "Surat",
    "story": "In Gujarat, puran poli is called vedmi, made through Makar Sankranti, Holi and other festive thalis. Unlike the Maharashtrian version's chana dal, the filling here is tuvar dal cooked down with jaggery, cardamom and nutmeg into a firm paste. The dough, plain whole wheat flour and oil, is rolled out far thinner than elsewhere in the country, thin enough that the dark filling shows faintly through it, then cooked on a griddle and finished with a generous pour of melted ghee. Vedmi is served as part of a full Gujarati thali, alongside kadhi, a peas pulao, steamed patra and a vegetable shaak, with extra ghee poured over at the table.",
    "ingredients": "1 cup whole wheat flour\n1 tsp oil\n1/4 tsp salt\nwater, as needed\n1/2 cup tuvar dal\n1/2 cup jaggery, grated\n1/2 tsp cardamom powder\n1/4 tsp nutmeg powder\n8-10 saffron strands, optional\nghee, for roasting and serving",
    "method": "1. Rinse 1/2 cup tuvar dal and pressure cook with about 1.5 cups water for 3-4 whistles until completely soft.\n2. Drain any excess water and mash or blend the dal into a smooth, thick paste.\n3. Return the dal paste to a pan with 1/2 cup grated jaggery and cook on low heat, stirring constantly, until the mixture is thick enough for a spoon to stand upright in it.\n4. Stir in 1/2 tsp cardamom powder, 1/4 tsp nutmeg powder and the saffron strands if using; cool completely, ideally overnight, then shape into small balls.\n5. Knead 1 cup whole wheat flour with 1/4 tsp salt, 1 tsp oil and water into a soft dough; rest for 20 minutes.\n6. Roll a dough ball into a small disc, place a portion of the dal-jaggery filling in the centre, and seal the edges.\n7. Roll the stuffed disc out as thin as possible, thin enough that the dark filling shows faintly through the dough.\n8. Cook on a hot griddle, applying ghee generously on both sides, until light brown spots appear.\n9. Serve hot with an extra spoon of ghee, as part of a thali with kadhi, peas pulao and a vegetable shaak.",
    "source_url": "https://www.jcookingodyssey.com/vedhmi-puran-poli/"
  },
  {
    "n": 3,
    "recipe_name": "Puran poli",
    "state": "Karnataka",
    "city": "Mysuru",
    "story": "In Karnataka the same sweet stuffed flatbread is called holige or obbattu, and the Mysuru area follows its own style: bele obbattu, patted out by hand into a thicker, medium-sized round, as opposed to the thinner, rolling-pin-flattened bele holige made further south around Udupi. The filling pairs chana dal with jaggery and, in many Mysuru households, grated coconut and cardamom, cooked down to a smooth paste. The outer dough is maida or wheat flour worked soft with oil and a pinch of turmeric. It is made for Ugadi and other festive occasions across the state, and is served warm with a spoon of ghee, sometimes alongside milk.",
    "ingredients": "1 cup chana dal\n1 cup jaggery, grated\n1/2 cup grated coconut, optional\n1/2 tsp cardamom powder\n1 cup maida (all-purpose flour)\n1/2 cup whole wheat flour\n3 tbsp oil, plus more for kneading\n1/4 tsp turmeric powder\n1/4 tsp salt\nwater, as needed\nghee, for roasting and serving",
    "method": "1. Rinse 1 cup chana dal and pressure cook with enough water for 3-4 whistles, until the grains crush easily between the fingers.\n2. Drain the dal well and transfer to a pan with 1 cup grated jaggery; cook on low heat, mashing and stirring, until thick.\n3. For the coconut version, stir in 1/2 cup grated coconut along with the jaggery; otherwise proceed with dal and jaggery alone.\n4. Add 1/2 tsp cardamom powder and cook a few minutes more until the mixture leaves the sides of the pan, then cool and shape into balls.\n5. Knead the maida and wheat flour with the turmeric, salt, 3 tbsp oil and water into a soft, pliable dough; rest at least 30 minutes, then knead again until stretchy.\n6. Take a dough ball, flatten it, enclose a filling ball inside, and seal the edges completely.\n7. For the Mysuru style, pat the stuffed ball out by hand on a greased surface into a thick, medium-sized round rather than rolling it thin with a pin.\n8. Cook on a hot tawa with ghee on both sides until golden-brown spots appear.\n9. Serve warm with a spoon of ghee, plain or with a glass of milk.",
    "source_url": "https://vegrecipesofkarnataka.com/262-bele-holige-recipe-bele-obbattu-pooran-poli.php"
  },
  {
    "n": 4,
    "recipe_name": "Misal pav",
    "state": "Maharashtra",
    "city": "Kolhapur",
    "story": "Misal pav traces its origin to Kolhapur district in the early twentieth century, where it became a filling breakfast for mill workers in Kolhapur and nearby Nashik before a long day's labour. The Kolhapuri version is considered the spiciest across Maharashtra: a thick usal of sprouted moth beans and matki, cooked in a Kolhapuri masala of coconut, coriander and red chilli, is topped with crisp farsan, raw onion and coriander, and served with pav. What sets Kolhapur's misal apart is the separate kat or tarri, a thin, fiery red gravy poured over the usal just before eating, adding a second layer of heat on top of the curry itself.",
    "ingredients": "1 cup moth beans (matki), sprouted\n1/2 cup moong, sprouted, optional\n1 medium potato, boiled and cubed\n1/2 cup dry coconut, grated\n1/2 cup onion, chopped\n2 tbsp Kolhapuri misal masala or red chilli powder\n1 tbsp ginger-garlic paste\n2 medium tomatoes, chopped\n1 tsp turmeric powder\n4 tbsp oil\n1 tsp cumin seeds\n1 bay leaf\nsalt, to taste\nwater, as needed\n1 cup farsan (sev), for topping\n1/4 cup onion, finely chopped, for topping\n2 tbsp coriander leaves, chopped, for topping\nlemon wedges, for serving\npav (bread rolls), for serving",
    "method": "1. Boil the sprouted moth beans, and moong sprouts if using, with salt and turmeric until just tender but not mushy; drain and set aside.\n2. Dry roast the grated coconut and chopped onion separately until golden, cool, then grind together with the tomatoes and ginger-garlic paste into a smooth masala paste.\n3. Heat 2 tbsp oil in a pan, add the ground paste along with the Kolhapuri misal masala, and cook until the oil separates, to make the thick usal base.\n4. Add the boiled sprouts and potato to the usal base, pour in a little water, and simmer for 10-12 minutes until the flavours come together.\n5. Separately, heat the remaining 2 tbsp oil, add the cumin seeds and bay leaf, then thin more of the masala with extra water and a little more chilli powder to make a thin, fiery kat, also called tarri or rassa; simmer briefly.\n6. To serve, ladle the thick usal into a bowl and top generously with farsan, chopped onion and coriander leaves.\n7. Pour the hot kat over the usal at the table just before eating, so the gravy stays thin and fresh.\n8. Serve immediately with pav on the side and lemon wedges for squeezing over.",
    "source_url": "https://oteats.outlooktraveller.com/recipes/story-of-maharashtras-misal-pav-and-how-to-make-it-at-home"
  },
  {
    "n": 5,
    "recipe_name": "Litti chokha",
    "state": "Bihar",
    "city": "Patna",
    "story": "Litti chokha is the signature dish of Bihar's countryside, eaten across Patna's street stalls and home kitchens alike. Litti — a whole-wheat dough ball stuffed with a spiced roasted-gram (sattu) filling — is traditionally baked over an open wood or cow-dung-cake fire, which gives it a smoky crust, before it is dunked in ghee. It is served with chokha, a coarse mash of fire-roasted brinjal and potato dressed with mustard oil, garlic and green chilli. The dish carries particular weight during Chhath Puja, when it is offered as prasad, and it also appears at Makar Sankranti gatherings across the region.",
    "ingredients": "1 cup whole wheat flour\n1 tsp ajwain (carom seeds)\n2 tsp ghee, plus extra for dunking\n1/4 tsp baking soda\nSalt to taste\nWarm water, as needed\n2/3 cup sattu (roasted gram flour)\n1 tsp ajwain\n1 tsp cumin seeds\n1/2 tsp lemon juice\n1 tbsp chopped green chillies\n2 tbsp chopped mixed pickle masala\n1/3 cup chopped coriander leaves\n1 large brinjal (eggplant)\n1 large potato\n2 medium tomatoes\n1 cup chopped onion\n3 green chillies\n1 inch ginger, chopped\n1/2 cup chopped coriander leaves\n2 tbsp mustard oil",
    "method": "1. Make a stiff dough with the wheat flour, ajwain, 2 tsp ghee, baking soda, salt and warm water; cover and rest for 20 minutes.\n2. For the stuffing, mix sattu with ajwain, cumin seeds, lemon juice, chopped green chillies, pickle masala, coriander leaves, salt and a little water into a crumbly but bindable mixture.\n3. Divide the dough into balls, flatten each into a small cup, fill with 1-2 tbsp of the sattu stuffing, and seal by pinching the edges shut.\n4. Roast the stuffed balls in a moderately hot oven (about 200C) or over glowing embers, turning occasionally, for 25-30 minutes until the crust is golden and cracked.\n5. Meanwhile, roast the brinjal directly over an open flame until the skin blisters and the flesh softens; roast or bake the potato and tomatoes until soft.\n6. Peel the brinjal and potato, then mash them together with the tomatoes, chopped onion, green chillies, ginger, coriander leaves and salt.\n7. Stir in the mustard oil and mix well to finish the chokha.\n8. Crack open the hot littis, dunk them in melted ghee, and serve immediately with the chokha.",
    "source_url": "https://aahaaramonline.com/litti-chokha-traditional-recipe-bihar/"
  },
  {
    "n": 6,
    "recipe_name": "Pesarattu",
    "state": "Andhra Pradesh",
    "city": "Guntur",
    "story": "Pesarattu is a crepe made from whole green gram, a breakfast standard across coastal Andhra Pradesh and closely associated with Guntur and the Godavari districts. Unlike idli or dosa batter, the ground moong needs no fermentation and is cooked the same day it is soaked. In Guntur's hotels and tiffin centres, the crepe is folded around a portion of rava upma and finished with ginger chutney (allam pachadi) and coconut chutney — a combination sold on menus as 'MLA pesarattu.' The dal is ground with its skin on, which gives the batter its deep green colour and the finished crepe its thin, crisp edge.",
    "ingredients": "1 cup whole green gram (moong dal, skin on), soaked 6-8 hours\n1/4 cup rice, soaked with the dal\n1 inch ginger piece\n2-3 green chillies\n1 tsp cumin seeds\nSalt to taste\n1 medium onion, finely chopped, for topping\nOil or ghee, for cooking\n1 cup semolina (rava/sooji)\n2 cups water\n1 onion, chopped\n2 green chillies, chopped\n1/2 tsp mustard seeds\n1 tsp chana dal\nFew curry leaves\n2 tsp ghee\n2 tbsp oil\n2 inch ginger, chopped\n2 tbsp tamarind pulp\n2-3 dried red chillies\n1 tsp mustard seeds\n1 tsp urad dal\nJaggery and salt to taste",
    "method": "1. Soak the whole green gram and rice together for 6-8 hours, then drain.\n2. Grind the soaked dal and rice with ginger, green chillies and cumin seeds into a smooth, thick batter using as little water as possible; season with salt. No resting or fermentation is needed.\n3. For the upma, dry-roast the semolina lightly in a pan and set aside. Heat ghee, temper with mustard seeds, chana dal and curry leaves, then saute the chopped onion and green chillies.\n4. Add the water, bring to a boil, season with salt, and stir in the roasted semolina, cooking until it thickens and comes away from the pan.\n5. For the ginger chutney, heat the oil and fry the ginger, dried red chillies, mustard seeds and urad dal briefly, then grind with tamarind pulp, jaggery and salt to a smooth paste.\n6. Heat a griddle, pour a ladle of pesarattu batter onto it and spread thin in a circular motion.\n7. Scatter chopped onion over the crepe, drizzle oil around the edges, and cook on low-medium heat until the base turns golden and crisp.\n8. Place a portion of upma on one half of the crepe, fold it over, and serve hot with the ginger chutney and coconut chutney.",
    "source_url": "http://ammachethivantaluu.blogspot.com/2012/10/pesarattu-is-very-popular-breakfast.html"
  },
  {
    "n": 7,
    "recipe_name": "Undhiyu",
    "state": "Gujarat",
    "city": "Surat",
    "story": "Undhiyu is a mixed-vegetable dish tied to the Gujarati winter, and Surat's version — Surti undhiyu — is treated as its benchmark. The name comes from 'undhu,' meaning upside down, describing the old method of sealing the vegetables inside an earthen pot called a matlu, setting it mouth-down in a pit, and firing it from above with embers; cooked this way it is also called umbadiyu. The dish leans on produce that is only in season in winter around Surat, Navsari and Valsad — surti papdi, purple yam, small brinjals, green garlic and raw banana — layered with fenugreek-dumpling muthia. It is traditionally served with puri, at winter weddings and banquets and around Uttarayan.",
    "ingredients": "5-6 baby eggplants\n4-5 medium potatoes\n1 cup purple yam, peeled and chopped\n1 raw banana, cubed\n1/4 cup green peas\n1/2 cup tuvar (lilva) beans\n1 cup chopped surti papdi (flat beans)\n7-8 fried methi muthia (fenugreek dumplings)\n1/2 cup grated fresh coconut\n1/4 cup chopped coriander leaves\n1/4 cup chopped green garlic\n1 inch ginger piece\n2-3 green chillies\n1/4 cup roasted peanuts\n1 tsp sesame seeds\n1 tsp sugar\n2-3 tbsp oil\n1/2 tsp cumin seeds\n1/4 tsp mustard seeds\n1/4 tsp carom seeds (ajwain)\n1/4 tsp asafoetida\n1/2 tsp turmeric powder\n1 tsp coriander powder\n1/2 tsp cumin powder\n1/2 tsp red chilli powder\n1 tsp garam masala\nSalt to taste\nLime juice, for garnish",
    "method": "1. Grind the coconut, coriander leaves, green garlic, ginger, green chillies, roasted peanuts, sesame seeds and sugar with a little water into a coarse green paste; season with salt.\n2. Cross-cut the baby eggplants and potatoes without separating the quarters; slit the raw banana pieces for stuffing.\n3. Stuff the eggplants, potato and banana pieces generously with the green paste.\n4. Deep-fry the purple yam cubes until golden and drain; keep the fried methi muthia ready.\n5. Heat oil in a heavy pot and temper with cumin seeds, mustard seeds, carom seeds and asafoetida.\n6. Add the chopped surti papdi, a portion of the remaining green paste, turmeric, coriander powder, cumin powder, red chilli powder and garam masala; saute briefly.\n7. Layer in the stuffed potatoes, eggplants, banana, fried yam and muthia, spread the rest of the green paste over the top, and add about a cup of water.\n8. Cover and simmer on low-medium heat for 10-12 minutes (or pressure-cook for 2-3 whistles) until the vegetables are tender without turning mushy.\n9. Mix gently, finish with lime juice and a scattering of coconut and coriander, and serve hot with puri.",
    "source_url": "https://binjalsvegkitchen.com/surti-undhiyu-recipe-gujarati-undhiyu/"
  },
  {
    "n": 8,
    "recipe_name": "Bisi bele bath",
    "state": "Karnataka",
    "city": "Bengaluru",
    "story": "Bisi bele bath — Kannada for 'hot lentil rice' — is a one-pot rice-and-toor-dal dish built on its own spice blend, distinct from sambar powder, that includes marathi moggu (kapok buds) alongside coriander, dried red chillies, cinnamon and cloves. Food writers trace it to the Mysore Palace kitchens roughly three centuries ago, from where it travelled to Udupi's eateries and then spread across the old Mysore region of Karnataka; it is now a fixture of Bengaluru's Udupi-style restaurants, MTR among them. It is cooked with mixed vegetables and tamarind, finished with a ghee-and-cashew tempering, and served hot with boondi, papad or potato chips.",
    "ingredients": "1 cup rice (sona masuri)\n3/4 cup toor dal\n1/2 tsp turmeric powder\n1/4 cup raw peanuts\n1/4 tsp rock salt\n1 medium carrot, chopped\n18-20 French beans, chopped\n1/2 cup green peas\n3-4 small brinjals, chopped\n1 medium onion, chopped\n1 medium tomato, chopped\n1 tbsp tamarind, soaked in 1/2 cup warm water\n2 tbsp desiccated coconut\n3 tbsp bisi bele bath powder, mixed in 1 cup water\n3-4 tbsp ghee\n1 tsp mustard seeds\n12-15 curry leaves\n1-2 marathi moggu (kapok buds)\n2-3 dried red chillies\n18-20 cashews\n1/4 tsp asafoetida\nSalt to taste",
    "method": "1. Rinse the rice and cook it with the raw peanuts, rock salt and 2.5 cups water until soft; set aside.\n2. Rinse the toor dal and pressure-cook it with turmeric powder and 2 cups water until soft and mushy.\n3. In a separate pot, cook the carrot, French beans, peas, brinjal, onion and tomato with a little salt and water until just tender.\n4. Squeeze the soaked tamarind to extract the pulp and strain it.\n5. Combine the cooked rice, dal and vegetables in a large pot; stir in the tamarind pulp and the bisi bele bath powder dissolved in water.\n6. Add the desiccated coconut and remaining salt, then simmer for 8-10 minutes, adding water as needed to loosen the consistency, until the flavours come together.\n7. In a small pan, heat the ghee and temper with mustard seeds, curry leaves, marathi moggu, dried red chillies, cashews and asafoetida until the cashews turn golden.\n8. Pour the tempering over the bisi bele bath, mix well, and serve hot with boondi, papad or potato chips.",
    "source_url": "https://www.vegrecipesofindia.com/bisi-bele-bath-recipe/"
  },
  {
    "n": 9,
    "recipe_name": "Chhena poda",
    "state": "Odisha",
    "city": "Nayagarh",
    "story": "Chhena poda is associated with Dasapalla, a village in Nayagarh district, where it is said to have been created in the early twentieth century by a confectioner, Sudarshan Sahu, who baked leftover sweetened chhena overnight in a still-warm chulha. The accidental caramelised crust that resulted became the dish's defining feature, and Nayagarh is credited as its place of origin even as it spread across Odisha as a festive sweet, made for occasions such as Durga Puja and Diwali. It is traditionally baked wrapped in sal or banana leaves in an earthen oven, and is eaten plain, sliced, once cooled and set.",
    "ingredients": "250 grams fresh chhena (cottage cheese), crumbled\n1/2 cup sugar (about 125 grams), or jaggery powder\n1/2 tablespoon rice flour or semolina\n1/2 teaspoon cardamom powder\n8-10 cashews, chopped\n1 tablespoon raisins\n2 teaspoons ghee, for greasing and drizzling\nBanana leaves or parchment paper, for lining the pan",
    "method": "1. Line a baking pan with banana leaves or parchment paper and grease generously with ghee.\n2. Preheat the oven to 180°C (350°F).\n3. Crumble the fresh chhena finely with clean hands until no lumps remain.\n4. Add the sugar to the crumbled chhena and knead together for 8-10 minutes until it turns soft, glossy and loose, like a thick batter.\n5. Mix in the cardamom powder and rice flour, then fold in the chopped cashews and raisins.\n6. Pour the mixture into the prepared pan, spread it evenly, and drizzle a little ghee over the top.\n7. Bake for 35-45 minutes, until the top turns deep golden-brown and caramelised.\n8. Check doneness by inserting a skewer in the centre; it should come out clean.\n9. Let it cool completely in the pan before turning it out, so it sets and slices cleanly.\n10. Slice into squares or diamonds and serve at room temperature.",
    "source_url": "https://www.incredibleindia.gov.in/en/odisha/bhubaneswar/chhenapoda"
  },
  {
    "n": 10,
    "recipe_name": "Shukto",
    "state": "West Bengal",
    "city": "Kolkata",
    "story": "Shukto is served as the first course of a traditional Bengali lunch, eaten with plain rice before the dal and other curries arrive, meant to prepare the palate for the courses that follow. Its defining vegetable is bitter gourd, balanced against sweeter ones such as raw banana, sweet potato and drumstick, all simmered together in a light mustard-and-poppy-seed gravy tempered with panch phoron and finished with a little milk. In Kolkata and across West Bengal it is cooked for everyday family lunches as well as festive spreads such as Durga Puja bhog, where it remains the opening dish of the meal rather than a side.",
    "ingredients": "150 g drumstick (sojne data), cut into batons\n100 g potato, cut into wedges\n100 g brinjal, cut into wedges\n150 g raw banana (kachkola), cut into wedges\n150 g raw papaya, cut into wedges\n100 g flat beans (sheem), halved\n50 g bitter gourd (korola), sliced\n120 g sweet potato, cut into wedges\n8-10 sun-dried lentil dumplings (bori)\n60 ml mustard oil\n4 bay leaves\n1/2 teaspoon panch phoron\n1 tablespoon ginger paste\n1 tablespoon mustard seeds, ground to a paste\n1 tablespoon poppy seeds, ground to a paste\n2 tablespoons grated coconut\n1/2 cup milk\n1/4 teaspoon plain flour\nSalt, to taste\n2 teaspoons sugar\n1/2 teaspoon ground radhuni (wild celery seed), optional\n1 teaspoon ghee",
    "method": "1. Cut the potato, sweet potato, raw banana, papaya and brinjal into similar-sized wedges; halve the flat beans; slice the bitter gourd; cut the drumstick into 5 cm lengths.\n2. Parboil the drumstick, papaya, flat beans, sweet potato and potato in salted water for about 15 minutes; drain and reserve the water.\n3. Heat the mustard oil in a kadai and fry the bori until golden; remove. In the same oil, fry the bitter gourd, raw banana and brinjal separately until lightly golden; set aside.\n4. In the remaining oil, temper with the bay leaves and panch phoron, then add the ginger paste and fry for a minute.\n5. Add the ground mustard and poppy seed paste and cook until the oil separates, splashing in a little water if it catches.\n6. Add the boiled potato and cook for 3 minutes, then add the rest of the boiled vegetables, the fried raw banana, and the fried bori, along with salt and sugar.\n7. Stir in the grated coconut, then fold in the reserved vegetable water along with the fried brinjal and bitter gourd; mix gently to keep the vegetables intact.\n8. Whisk the milk with the flour and pour it in; simmer on low heat for 3-5 minutes until everything is cooked through and the gravy lightly thickens.\n9. Crush the radhuni and sprinkle it over the top, add the ghee, cover and let it rest for a minute before serving hot with plain rice.",
    "source_url": "https://www.bongeats.com/recipe/shukto"
  },
  {
    "n": 11,
    "recipe_name": "Sol kadhi",
    "state": "Goa",
    "city": "Panaji",
    "story": "Sol kadhi is a kokum-and-coconut-milk preparation common across the Konkan coast, including Goa, coastal Maharashtra and the Malvani belt. In Goa it typically appears alongside a fish thali, steamed rice, fish curry and fried fish, served in a small glass or bowl to be sipped between bites or poured over rice at the end of the meal. Its pale pink colour comes from kokum, the dried rind of a fruit native to the Western Ghats, soaked and strained into coconut milk, then tempered with mustard seeds, curry leaves, garlic and dried red chilli. In Panaji's beach-shack and thali restaurants it is served as a standard accompaniment to seafood meals rather than as a stand-alone dish.",
    "ingredients": "12-15 dried kokum petals\n1 cup water, for soaking the kokum\n1 to 1.5 cups thick coconut milk\n2 cups water\nSalt, to taste\n1 to 2 tablespoons chopped coriander leaves\n1.5 tablespoons oil, for tempering\n1 teaspoon mustard seeds\n1 teaspoon cumin seeds\n9-10 curry leaves\n2-3 garlic cloves, crushed\n1-2 dried Kashmiri red chillies, broken\nA pinch of asafoetida",
    "method": "1. Rinse the dried kokum petals and soak them in 1 cup of water for 30 minutes.\n2. Squeeze and crush the kokum in the water to release its colour and tang, then strain through a fine sieve, pressing the pulp to extract all the liquid.\n3. Whisk the kokum extract into the coconut milk, then add the 2 cups of water and salt to taste, adjusting the consistency.\n4. Heat the oil in a small pan and add the mustard seeds; let them crackle.\n5. Add the cumin seeds, curry leaves, garlic and broken red chillies; fry until the garlic turns light golden, then add the asafoetida.\n6. Pour the tempering over the kokum-coconut mixture and stir well.\n7. Stir in the chopped coriander leaves.\n8. Chill or serve immediately in small glasses or bowls alongside a rice-and-fish meal.",
    "source_url": "https://www.vegrecipesofindia.com/kokum-curry-sol-kadhi/"
  },
  {
    "n": 12,
    "recipe_name": "थालीपीठ",
    "state": "Maharashtra",
    "city": "Nashik",
    "story": "थालीपीठ ही महाराष्ट्रातील पारंपरिक बहुधान्य भाकरी आहे, जी 'भाजणी' या खास पिठापासून बनवली जाते. भाजणीमध्ये ज्वारी, बाजरी, तांदूळ, चणाडाळ, उडदाडाळ, धणे आणि जिरे हे जिन्नस वेगवेगळे खमंग भाजून एकत्र दळले जातात. या पिठात कांदा, कोथिंबीर, हिरवी मिरची, आले-लसूण व मसाले घालून मळलेले पीठ तव्यावर हाताने थापून भाजले जाते. नाशिक भागातील थालीपीठाची चव इतर काही भागांच्या तुलनेत सौम्य असते. हे न्याहारीला किंवा दुपारच्या जेवणात दही, लोणी किंवा लोणच्यासोबत खाल्ले जाते.",
    "ingredients": "तांदूळ - ४ वाट्या (भाजणीसाठी)\nज्वारी - २ वाट्या (भाजणीसाठी)\nबाजरी - १ वाटी (भाजणीसाठी)\nचणाडाळ - १/२ वाटी (भाजणीसाठी)\nउडदाडाळ - १/२ वाटी (भाजणीसाठी)\nधणे - १ वाटी (भाजणीसाठी)\nजिरे - १/२ वाटी (भाजणीसाठी)\nभाजणी पीठ - दीड वाटी (थालीपीठासाठी)\nकांदा (बारीक चिरलेला) - १ मोठा\nकोथिंबीर (बारीक चिरलेली) - अर्धी जुडी\nहिरवी मिरची (बारीक चिरलेली) - २\nआले-लसूण पेस्ट - १ चमचा\nहळद पूड - पाव चमचा\nलाल तिखट - १ चमचा\nमीठ - चवीनुसार\nतेल - मळण्यासाठी व भाजण्यासाठी ३-४ चमचे\nकोमट पाणी किंवा ताक - गरजेनुसार",
    "method": "1. तांदूळ स्वच्छ धुऊन पूर्णपणे वाळवून घ्यावेत.\n2. तांदूळ, ज्वारी व बाजरी हे धान्य एकेक करून मंद आचेवर लालसर रंग येईपर्यंत खमंग भाजावेत.\n3. चणाडाळ व उडदाडाळ वेगळ्या भाजाव्यात, दाणा दाबल्यावर सहज तुटेल इतपत भाजावे.\n4. धणे व जिरे वेगळे खमंग भाजून घ्यावेत.\n5. सर्व भाजलेले जिन्नस एकत्र करून थंड झाल्यावर बारीक दळून घ्यावेत आणि हवाबंद डब्यात साठवावेत, हीच भाजणी.\n6. भाजणी पिठात कांदा, कोथिंबीर, हिरवी मिरची, आले-लसूण पेस्ट, हळद, तिखट, मीठ व एक चमचा तेल घालावे.\n7. कोमट पाणी किंवा ताक घालून घट्टसर पीठ मळून घ्यावे.\n8. पिठाचा गोळा घेऊन ओल्या हाताने तव्यावर किंवा प्लास्टिकच्या कागदावर गोलाकार पातळ थापावे.\n9. मध्यभागी व कडेने बोटाने ३-४ छिद्रे पाडावीत.\n10. थापलेले थालीपीठ गरम तव्यावर ठेवावे आणि छिद्रांमधून व कडेने थोडे थोडे तेल सोडावे.\n11. मध्यम आचेवर एक बाजू खरपूस भाजल्यावर उलटावे आणि दुसरी बाजूही तेल सोडून खरपूस भाजावी.\n12. गरम थालीपीठ दही, लोणी किंवा लोणच्यासोबत वाढावे.",
    "source_url": "https://poonambachhav.blogspot.com/2017/03/bhajaniche-thalipeeth-multigrain.html"
  }
];

const AGENT = "Arpit's Agent";
const CONTACT = "arpits-agent@example.invalid";

const dry = process.argv.includes("--dry");
const retag = process.argv.includes("--retag");

/** The identity of a seeded row: the trio shares a name and differs by state. */
const key = (recipe_name: string, state: string) => `${recipe_name} :: ${state}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const db = await communityDb();
  if (!db) {
    console.error(
      "seed-community: no store. ATLAS_URL/ATLAS_USER/ATLAS_PASSWORD unset, or Atlas\n" +
        "Network Access does not allow this machine. A local failure here is almost\n" +
        "always one of those two, not the code.",
    );
    process.exit(1);
  }
  const col = db.collection<SubmissionDoc>(SUBMISSIONS);

  // Every read and every write in this script is filtered on the agent's
  // display name. It cannot see, let alone touch, a reader's submission.
  const MINE = { "submission.display_name": AGENT } as const;

  const existing = await col
    .find(MINE, { projection: { "submission.recipe_name": 1, "submission.state": 1, "dish.tag": 1 } })
    .toArray();
  const seen = new Set(existing.map((d) => key(d.submission.recipe_name, d.submission.state)));
  console.log(`agent rows already in the store: ${existing.length}`);

  if (retag) {
    await retagTrio(col, MINE);
    process.exit(0);
  }

  const todo = ENTRIES.filter((e) => !seen.has(key(e.recipe_name, e.state)));
  for (const e of ENTRIES) {
    const already = seen.has(key(e.recipe_name, e.state));
    console.log(`  ${already ? "skip  " : "insert"} ${e.recipe_name} · ${e.state}`);
  }
  console.log(`\n${todo.length} to insert, ${ENTRIES.length - todo.length} already there.`);

  if (dry) {
    console.log("\n--dry: nothing was written.");
    for (const e of ENTRIES) console.log(`  ${e.recipe_name} · ${e.state} — ${e.source_url}`);
    process.exit(0);
  }

  const results: Array<{
    name: string;
    state: string;
    card: string;
    tag: string;
    aliases: number;
    published: string;
  }> = [];

  for (const e of todo) {
    const submission = {
      display_name: AGENT,
      state: e.state,
      city: e.city,
      belongs_to: "my own",
      recipe_name: e.recipe_name,
      story: e.story,
      ingredients: e.ingredients,
      method: e.method,
      contact: CONTACT,
      consent: { right_to_share: true, public_display: true },
    };

    // Seed data that skips the validator proves nothing about the real path.
    const valid = validateSubmission(submission);
    if (!valid.ok) {
      console.error(`\nFAIL ${e.recipe_name} · ${e.state} did not validate:`);
      for (const err of valid.errors) console.error(`  - ${err}`);
      process.exit(1);
    }

    const id = await insertSubmission({ mode: "manual", submission: valid.value, geo: NO_GEO });
    if (!id) {
      console.error(`\nFAIL ${e.recipe_name} · ${e.state}: the store refused the insert (daily ceiling?)`);
      process.exit(1);
    }

    const verdict = await moderate(valid.value);
    if (!verdict) {
      console.log(`  ${e.recipe_name} · ${e.state}: the verdict call failed — left pending`);
      results.push({ name: e.recipe_name, state: e.state, card: "—", tag: "—", aliases: 0, published: "no" });
      await sleep(1200);
      continue;
    }
    await applyVerdict(id, verdict);

    let published = "no";
    if (verdict.card === "GREEN") {
      const p = await publishSubmission(id);
      published = p === "ok" ? "yes" : p;
    }
    results.push({
      name: e.recipe_name,
      state: e.state,
      card: verdict.card,
      tag: verdict.dish_tag,
      aliases: verdict.aliases.length,
      published,
    });
    console.log(`  ${verdict.card} ${e.recipe_name} · ${e.state} → ${verdict.dish_tag} (${verdict.aliases.length} aliases, published ${published})`);
    await sleep(1200);
  }

  console.log("\n  recipe · state — card — tag — aliases — published");
  for (const r of results) {
    console.log(`  ${r.name} · ${r.state} — ${r.card} — ${r.tag} — ${r.aliases} — ${r.published}`);
  }
  const pending = results.filter((r) => r.card === "—").length;
  if (pending) console.log(`\n${pending} left pending; re-run their verdict from /pantry.`);
  process.exit(0);
}

/**
 * The trio must share one dish tag or the geo rule has nothing to choose
 * between. Only run when Step 4 says the model disagreed with itself; it
 * rewrites nothing else, and never a row that is not the agent's.
 */
async function retagTrio(
  col: Collection<SubmissionDoc>,
  mine: { "submission.display_name": string },
): Promise<void> {
  const trio = await col
    .find({ ...mine, "submission.recipe_name": "Puran poli" }, { projection: { "dish.tag": 1, "submission.state": 1 } })
    .toArray();
  if (trio.length !== 3) {
    console.error(`--retag expected 3 Puran poli rows, found ${trio.length}. Doing nothing.`);
    process.exit(1);
  }
  const tally = new Map<string, number>();
  for (const d of trio) tally.set(d.dish?.tag ?? "", (tally.get(d.dish?.tag ?? "") ?? 0) + 1);
  const [winner] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) {
    console.error("--retag found no tag to agree on. Doing nothing.");
    process.exit(1);
  }
  console.log(`majority tag: ${winner}`);
  for (const d of trio) {
    if (d.dish?.tag === winner) continue;
    console.log(`  rewriting ${String(d._id)} (${d.submission.state}): ${d.dish?.tag} → ${winner}`);
    await col.updateOne({ _id: d._id, ...mine }, { $set: { "dish.tag": winner, updated_at: new Date() } });
  }
}

void main();
