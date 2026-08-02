/**
 * One-off: merge harvested recipes (from the workflow output file) into
 * data/recipes.json, deduping against existing records and within the batch.
 *   node scripts/merge-harvest.mjs <workflow-output-file>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const RECIPES = 'data/recipes.json';

const wrapper = JSON.parse(readFileSync(OUT, 'utf8'));
let res = wrapper.result;
if (typeof res === 'string') res = JSON.parse(res);
const harvested = res.recipes ?? [];
const existing = JSON.parse(readFileSync(RECIPES, 'utf8'));

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/\s+/g, '-').slice(0, 48) || 'recipe';

// Build the dedupe set from existing names, transliterations, aliases.
const seen = new Set();
for (const r of existing) {
  seen.add(norm(r.name.english));
  seen.add(norm(r.name.transliteration));
  (r.aliases || []).forEach((a) => seen.add(norm(a)));
}

// Highest existing numeric id suffix, so new ids continue cleanly.
let n = 0;
for (const r of existing) {
  const m = /(\d+)\s*$/.exec(r.id);
  if (m) n = Math.max(n, parseInt(m[1], 10));
}

const added = [];
let skipDupe = 0;
let skipBad = 0;

for (const h of harvested) {
  if (!h?.name?.english || !h?.source?.url) { skipBad++; continue; }
  if (!Array.isArray(h.ingredients) || h.ingredients.length === 0) { skipBad++; continue; }
  if (!Array.isArray(h.steps) || h.steps.length === 0) { skipBad++; continue; }

  const keyE = norm(h.name.english);
  const keyT = norm(h.name.transliteration);
  const aliasKeys = (h.aliases || []).map(norm);
  if (seen.has(keyE) || (keyT && seen.has(keyT)) || aliasKeys.some((a) => seen.has(a))) {
    skipDupe++;
    continue;
  }
  seen.add(keyE);
  if (keyT) seen.add(keyT);
  aliasKeys.forEach((a) => seen.add(a));

  n += 1;
  added.push({
    id: `wf-${slug(h.name.transliteration || h.name.english)}-${String(n).padStart(3, '0')}`,
    aliases: Array.isArray(h.aliases) ? h.aliases : [],
    name: {
      original: h.name.original || '',
      transliteration: h.name.transliteration || '',
      english: h.name.english,
    },
    source: {
      text: h.source.text || '',
      author: h.source.author || '',
      period: h.source.period || '',
      citation: h.source.citation || '',
      url: h.source.url,
    },
    region: h.region || 'India',
    category: h.category || 'dish',
    ingredients: h.ingredients.map((i) => ({
      original: i.original || '',
      modern_name: i.modern_name || '',
      quantity: i.quantity || 'not specified',
    })),
    steps: h.steps,
    properties: {
      ayurvedic: h.properties?.ayurvedic ?? null,
      occasion: h.properties?.occasion ?? null,
      season: h.properties?.season ?? null,
    },
    notes: h.notes ?? null,
    verification_status: h.verification_status || 'sourced-unverified',
  });
}

const merged = existing.concat(added);
writeFileSync(RECIPES, JSON.stringify(merged, null, 2) + '\n', 'utf8');

console.log(`existing ${existing.length} + harvested ${harvested.length}`);
console.log(`  added (new/unique): ${added.length}`);
console.log(`  skipped duplicates: ${skipDupe}`);
console.log(`  skipped incomplete: ${skipBad}`);
console.log(`  TOTAL now: ${merged.length}`);
