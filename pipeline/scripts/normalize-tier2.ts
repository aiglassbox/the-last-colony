/**
 * Normalizes a bulk modern-Indian recipe CSV into data/dishes.json (Tier 2).
 *
 *   npm run normalize:tier2            # reads data/raw/indian_recipes.csv
 *   npm run normalize:tier2 -- <path>  # or an explicit CSV path
 *
 * What it does:
 *   1. Parses the CSV (RFC-4180: quotes, embedded commas/newlines, BOM).
 *   2. Maps whatever column names the dataset uses onto our fields.
 *   3. Cleans + dedupes rows (by normalized dish name).
 *   4. Tags every record tier:2 / source:'modern' so it can NEVER be confused
 *      with the authentic Tier-1 corpus.
 *   5. Scans each dish against data/substitutions.json `triggers` and attaches
 *      the candidate healthier-swap rule ids — so Tier 2 is derived from data,
 *      not hand-written per dish.
 *
 * data/dishes.json is a derived artifact: safe to delete and regenerate.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { ModernDish, Substitution } from '../lib/types.js';

const DEFAULT_CSV = new URL('../data/raw/indian_recipes.csv', import.meta.url);
const SUBS_PATH = new URL('../data/substitutions.json', import.meta.url);
const OUT_PATH = new URL('../data/dishes.json', import.meta.url);
const DATASET = 'kaggle:6000-indian-food-recipes';

const csvArg = process.argv[2];
const csvUrl = csvArg ? new URL(`file://${resolveArg(csvArg)}`) : DEFAULT_CSV;

const raw = await readCsv(csvUrl);
if (!raw) process.exit(1);

const subs = JSON.parse(await readFile(SUBS_PATH, 'utf8')) as Substitution[];

const table = parseCsv(raw);
if (table.length < 2) {
  console.error('CSV has no data rows.');
  process.exit(1);
}

const header = table[0].map(normalizeHeader);
const col = mapColumns(header);
if (col.name === -1) {
  console.error(`Could not find a recipe-name column. Headers seen: ${header.join(', ')}`);
  process.exit(1);
}

const seen = new Set<string>();
const dishes: ModernDish[] = [];
let skippedDupes = 0;
let skippedEmpty = 0;

for (const row of table.slice(1)) {
  const name = clean(cell(row, col.name));
  if (!name) { skippedEmpty++; continue; }

  const key = name.toLowerCase();
  if (seen.has(key)) { skippedDupes++; continue; }
  seen.add(key);

  const ingredients = splitList(cell(row, col.ingredients));
  const steps = splitSteps(cell(row, col.instructions));
  const { rich_flags, substitution_ids } = detectRich(ingredients, steps, subs);

  dishes.push({
    id: `modern-${slug(name)}`,
    tier: 2,
    source: 'modern',
    dataset: DATASET,
    name,
    aliases: [],
    cuisine: clean(cell(row, col.cuisine)) || null,
    course: clean(cell(row, col.course)) || null,
    diet: clean(cell(row, col.diet)).toLowerCase() || null,
    total_time_mins: toInt(cell(row, col.time)),
    servings: toInt(cell(row, col.servings)),
    ingredients,
    steps,
    url: clean(cell(row, col.url)) || null,
    rich_flags,
    substitution_ids,
  });
}

// Guarantee unique ids even when two names slugify the same.
const idCounts = new Map<string, number>();
for (const d of dishes) {
  const n = (idCounts.get(d.id) ?? 0) + 1;
  idCounts.set(d.id, n);
  if (n > 1) d.id = `${d.id}-${n}`;
}

await writeFile(OUT_PATH, JSON.stringify(dishes, null, 2) + '\n', 'utf8');

const withSwaps = dishes.filter((d) => d.substitution_ids.length > 0).length;
console.log(`Wrote ${dishes.length} Tier-2 dishes to data/dishes.json`);
console.log(`  ${withSwaps} have at least one candidate substitution`);
console.log(`  skipped ${skippedDupes} duplicate name(s), ${skippedEmpty} empty row(s)`);

// ---------------------------------------------------------------------------

async function readCsv(url: URL): Promise<string | null> {
  try {
    return await readFile(url, 'utf8');
  } catch {
    console.error(`No CSV found at ${decodeURIComponent(url.pathname)}`);
    console.error('Download the Kaggle "6000+ Indian Food Recipes" dataset and save the');
    console.error('CSV as data/raw/indian_recipes.csv — or pass a path:');
    console.error('  npm run normalize:tier2 -- ./path/to/file.csv');
    return null;
  }
}

function resolveArg(p: string): string {
  // Absolute Windows (C:\...) or POSIX (/...) path stays; else make it project-relative.
  if (/^([a-zA-Z]:[\\/]|\/)/.test(p)) return p.replace(/\\/g, '/');
  return new URL(`../${p}`, import.meta.url).pathname;
}

/** Minimal RFC-4180 CSV parser. Handles quotes, escaped "", commas + newlines in fields, BOM. */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface Cols {
  name: number; ingredients: number; instructions: number; cuisine: number;
  course: number; diet: number; time: number; servings: number; url: number;
}

function mapColumns(header: string[]): Cols {
  const find = (...cands: string[]) =>
    header.findIndex((h) => cands.includes(h));
  return {
    name: find('translatedrecipename', 'recipename', 'name', 'title'),
    ingredients: find('cleaningredients', 'cleanedingredients', 'translatedingredients', 'ingredients'),
    instructions: find('translatedinstructions', 'instructions', 'method', 'directions'),
    cuisine: find('cuisine'),
    course: find('course', 'category'),
    diet: find('diet'),
    time: find('totaltimeinmins', 'totaltime', 'time'),
    servings: find('servings', 'serves'),
    url: find('url', 'link'),
  };
}

function cell(row: string[], i: number): string {
  return i >= 0 && i < row.length ? row[i] : '';
}

function clean(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')      // strip stray HTML
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitList(s: string): string[] {
  const parts = s.includes('\n') ? s.split('\n') : s.split(',');
  return parts.map(clean).filter((x) => x.length > 0);
}

function splitSteps(s: string): string[] {
  const byLine = s.split('\n').map(clean).filter(Boolean);
  const parts = byLine.length > 1 ? byLine : clean(s).split(/(?<=\.)\s+/);
  return parts.map(clean).filter((x) => x.length > 1);
}

function toInt(s: string): number | null {
  const n = parseInt(clean(s), 10);
  return Number.isFinite(n) ? n : null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Match dish text against substitution triggers → candidate swap ids + the rich terms hit. */
function detectRich(
  ingredients: string[],
  steps: string[],
  subs: Substitution[],
): { rich_flags: string[]; substitution_ids: string[] } {
  const hay = ` ${[...ingredients, ...steps].join(' ').toLowerCase()} `;
  const flags = new Set<string>();
  const ids = new Set<string>();
  for (const s of subs) {
    for (const t of s.triggers) {
      if (hay.includes(t.toLowerCase())) {
        flags.add(t);
        ids.add(s.id);
      }
    }
  }
  return { rich_flags: [...flags], substitution_ids: [...ids] };
}
