/**
 * Demonstrates the Tier-3 map step against data/indianization.json.
 *
 *   npx tsx scripts/indianize-demo.ts
 *
 * In production, GEMINI decomposes the foreign dish into components (step 1) and
 * recomposes the result (step 3). This script hard-codes a few decompositions to
 * prove the middle step — the finite component→Indian lookup — works from data.
 */
import { readFile } from 'node:fs/promises';
import type { IndianizationRule } from '../lib/types.js';

const MAP = new URL('../data/indianization.json', import.meta.url);
const rules = JSON.parse(await readFile(MAP, 'utf8')) as IndianizationRule[];

// What Gemini would return as the decomposition of each foreign dish.
const decompositions: Record<string, string[]> = {
  Pizza: ['pizza base', 'pizza sauce', 'mozzarella cheese', 'olive oil', 'vegetable toppings'],
  'Pasta (white sauce)': ['pasta', 'white sauce', 'cheese', 'butter'],
  Cheeseburger: ['burger bun', 'beef patty', 'cheddar cheese', 'mayonnaise', 'deep-fried fries'],
};

function resolve(component: string): IndianizationRule[] {
  const c = component.toLowerCase();
  return rules.filter((r) => r.foreign.some((f) => c.includes(f.toLowerCase())));
}

for (const [dish, components] of Object.entries(decompositions)) {
  console.log(`\n=== ${dish}  →  Indian-inspired healthy version ===`);
  for (const component of components) {
    const hits = resolve(component);
    if (hits.length === 0) {
      console.log(`  • ${component}  →  keep as-is (fresh veg / no swap needed)`);
      continue;
    }
    const options = [...new Set(hits.flatMap((h) => h.indian_healthy))].slice(0, 2);
    const technique = hits.map((h) => h.technique_swap).find(Boolean);
    console.log(`  • ${component}  →  ${options.join('  |  ')}${technique ? `   [${technique}]` : ''}`);
  }
}

console.log('\n(Provenance: Tier 3 — Indian-inspired fusion, clearly labelled. Not an ancient recipe.)');
