/**
 * The whole answering surface, end to end: all three retrieval tiers through
 * the real chat route.
 *
 *   npm run check:system
 *
 * Needs a model key and the community store, so it is NOT part of
 * `npm run check` — same posture as `corpus:check-multilingual`.
 *
 * No server. `src/app/api/chat/route.ts` does not import `next/headers`, so
 * `POST` is called with a constructed `NextRequest` and the streamed NDJSON is
 * read here. That matters for more than convenience: it is the only way to
 * supply the geo headers Vercel sets at the edge, and therefore the only way
 * to exercise a state other than the one the machine is sitting in. In
 * production those headers cannot be spoofed, and on a local dev server they
 * are absent entirely, so without this the geo rule has no end-to-end coverage
 * at all.
 *
 * Each case gets its own `x-forwarded-for` so twenty-odd requests are not read
 * as one caller hammering the rate limiter.
 *
 * Cost: one language-detection call per case, plus a full completion for every
 * corpus and fallback case. Community cases stop before the model is asked to
 * write anything, so they are the cheap ones.
 */
import "dotenv/config";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/chat/route";

type Tier = "corpus" | "community" | "fallback";

interface Case {
  q: string;
  /** ISO 3166-2 subdivision, as Vercel's edge would send it. */
  region: string | null;
  tier: Tier;
  /** The reply language the detector must settle on. */
  lang: string;
  /** For a community hit: which state's submission must answer. */
  state?: string;
  tag?: string;
  why: string;
}

const CASES: Case[] = [
  // --- Tier 1: the corpus answers, across scripts ---------------------------
  { q: "khichdi", region: "MH", tier: "corpus", lang: "en", why: "English, corpus record" },
  { q: "खिचड़ी", region: "MH", tier: "corpus", lang: "hi", why: "Hindi native script" },
  { q: "দোসা", region: "WB", tier: "corpus", lang: "bn", why: "Bengali native script" },
  { q: "idli kaise banti hai", region: "MH", tier: "corpus", lang: "hi", why: "Hinglish sentence" },

  // --- Tier 2: a published community recipe answers -------------------------
  { q: "misal pav", region: "MH", tier: "community", lang: "en", state: "Maharashtra", tag: "misal-pav", why: "bare two-word name stays English" },
  { q: "how do I make misal pav at home", region: "MH", tier: "community", lang: "en", state: "Maharashtra", tag: "misal-pav", why: "phrase matched inside a sentence" },

  // The geo trio: one dish, three states. The reader's own state must win, and
  // this is the only place that rule is provable outside production.
  { q: "puran poli", region: "MH", tier: "community", lang: "en", state: "Maharashtra", tag: "puran-poli", why: "rule 1, reader's state" },
  { q: "puran poli", region: "GJ", tier: "community", lang: "en", state: "Gujarat", tag: "puran-poli", why: "rule 1, reader's state" },
  { q: "puran poli", region: "KA", tier: "community", lang: "en", state: "Karnataka", tag: "puran-poli", why: "rule 1, reader's state" },
  { q: "puran poli", region: "mh", tier: "community", lang: "en", state: "Maharashtra", tag: "puran-poli", why: "lowercase code still maps" },
  { q: "puran poli", region: "KL", tier: "community", lang: "en", tag: "puran-poli", why: "rule 3, mapped state matches no submission" },
  { q: "puran poli", region: null, tier: "community", lang: "en", tag: "puran-poli", why: "rule 3, no geo at all" },
  { q: "puran poli", region: "ZZ", tier: "community", lang: "en", tag: "puran-poli", why: "rule 3, unmapped code" },

  // Both spellings the region map accepts for Odisha, because vendors disagree.
  { q: "chhena poda", region: "OD", tier: "community", lang: "en", state: "Odisha", tag: "chhena-poda", why: "OD, the non-ISO code" },
  { q: "chhena poda", region: "OR", tier: "community", lang: "en", state: "Odisha", tag: "chhena-poda", why: "OR, the ISO code" },

  { q: "litti chokha", region: "BR", tier: "community", lang: "en", state: "Bihar", tag: "litti-chokha", why: "bare name, Bihari dish, stays English" },
  { q: "sol kadhi", region: "GA", tier: "community", lang: "en", state: "Goa", tag: "sol-kadhi", why: "bare name, Konkan dish, stays English" },
  { q: "bisi bele bath", region: "KA", tier: "community", lang: "en", state: "Karnataka", tag: "bisi-bele-bath", why: "bare name, Kannada dish, stays English" },

  // The Devanagari row, and the reader-language paths over it.
  { q: "थालीपीठ", region: "MH", tier: "community", lang: "hi", state: "Maharashtra", tag: "thalipith", why: "bare name in a native script keeps its language" },
  { q: "thalipeeth", region: "MH", tier: "community", lang: "en", state: "Maharashtra", tag: "thalipith", why: "romanized, English reader" },
  { q: "थालीपीठ कैसे बनाते हैं", region: "MH", tier: "community", lang: "hi", state: "Maharashtra", tag: "thalipith", why: "Hindi reader — a stored translation should serve" },

  // The route must hand the lookup the DISH NAME, not the reader's own words.
  // While it passed `label`, the community tier answered only when the typed
  // text happened to contain a stored alias — so these three missed and fell
  // through to the model, which then wrote a "no record yet" card for a dish
  // a reader had already sent in.
  { q: "लिटी चोखा", region: "BR", tier: "community", lang: "hi", state: "Bihar", tag: "litti-chokha", why: "misspelt Devanagari — one ट, not the लिट्टी conjunct that is stored" },
  { q: "मला आर्टिसन ब्रेडची रेसिपी द्या", region: "MH", tier: "community", lang: "mr", state: "Maharashtra", tag: "artisan-bread", why: "a whole Marathi sentence, not a bare name" },
  { q: "litti chokha kaise banate hain", region: "BR", tier: "community", lang: "hi", state: "Bihar", tag: "litti-chokha", why: "Hinglish sentence around the name" },

  // --- Tier 3: no record, no submission — the model answers ------------------
  { q: "pizza", region: "MH", tier: "fallback", lang: "en", why: "foreign, Indianisation card" },
  { q: "asdfgh", region: "MH", tier: "fallback", lang: "en", why: "nonsense, prose fallback" },
  { q: "vada pav", region: "MH", tier: "fallback", lang: "en", why: "retrieval declines it as ambiguous; its submissions are unpublished" },
];

interface Meta {
  mode?: string;
  kind?: string;
  lang?: string;
  community?: {
    dish_tag: string;
    state: string;
    city: string | null;
    language: string | null;
    translated_from: { language: string | null } | null;
    other_states: string[];
    total: number;
  };
  records?: unknown[];
}

async function run(c: Case, i: number): Promise<{ meta: Meta | null; status: number }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.0.0.${i + 1}`,
    "x-vercel-ip-country": "IN",
  };
  if (c.region) headers["x-vercel-ip-country-region"] = c.region;

  const request = new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [{ role: "user", content: c.q }] }),
  });

  const res = await POST(request);
  if (res.status !== 200) return { meta: null, status: res.status };

  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Meta & { type?: string };
      if (evt.type === "meta") return { meta: evt, status: 200 };
    } catch {
      /* a partial line is not a meta event */
    }
  }
  return { meta: null, status: 200 };
}

function tierOf(m: Meta): Tier {
  if (m.mode === "community") return "community";
  if (m.mode === "restoration" && m.kind === "record") return "corpus";
  return "fallback";
}

(async () => {
  let failed = 0;
  const rows: string[] = [];

  for (const [i, c] of CASES.entries()) {
    const { meta, status } = await run(c, i);
    if (!meta) {
      failed += 1;
      const line = `FAIL  ${c.q} — no meta event (status ${status})`;
      rows.push(line);
      console.error(`  ${line}`);
      continue;
    }

    const tier = tierOf(meta);
    const cm = meta.community;
    const lang = meta.lang ?? "en";
    const problems: string[] = [];
    if (tier !== c.tier) problems.push(`tier ${tier} != ${c.tier}`);
    // The reply language is the whole card's language, so a wrong one is a
    // wrong turn. A bare multi-word dish name used to be read as the dish's
    // own language, which handed an English reader a Marathi card.
    if (lang !== c.lang) problems.push(`lang ${lang} != ${c.lang}`);
    if (c.state && cm?.state !== c.state) problems.push(`state ${cm?.state} != ${c.state}`);
    if (c.tag && cm?.dish_tag !== c.tag) problems.push(`tag ${cm?.dish_tag} != ${c.tag}`);
    // A community turn carries no corpus records — that is what clears
    // activeRecordIds so a follow-up is not answered about the last one.
    if (tier === "community" && (meta.records?.length ?? 0) > 0) problems.push("carried corpus records");

    const detail =
      tier === "community"
        ? `${cm?.state}${cm?.city ? "/" + cm.city : ""} · ${cm?.dish_tag} · shown=${cm?.language ?? "—"}` +
          `${cm?.translated_from ? ` (translated from ${cm.translated_from.language ?? "unknown"})` : ""}` +
          ` · others=[${cm?.other_states.join(",")}] · total=${cm?.total}`
        : `${meta.mode}/${meta.kind ?? "—"} · records=${meta.records?.length ?? 0}`;

    if (problems.length) failed += 1;
    const line =
      `${problems.length ? "FAIL" : "ok  "}  ${(c.region ?? "—").padEnd(4)} ${c.q.padEnd(30)} ` +
      `lang=${lang.padEnd(3)} ${detail}${problems.length ? "   <-- " + problems.join("; ") : ""}`;
    rows.push(line);
    console.log(line);
  }

  console.log("\n================ SUMMARY ================");
  for (const r of rows) console.log(r);

  if (failed > 0) {
    console.error(`\ncheck-system: ${failed} of ${CASES.length} case(s) wrong.`);
    process.exit(1);
  }
  console.log(`\ncheck-system: all ${CASES.length} cases behaved as expected.`);
  // The pooled Mongo client holds the event loop open otherwise.
  process.exit(0);
})();
