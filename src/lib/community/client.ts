import { MongoClient, ObjectId, type Db } from "mongodb";

import type { Geo } from "../events/geo";
import { phraseMatches, pickCommunity, type CommunityMatch } from "./match";
import { dishTag, normalizeDish } from "./normalize";
import type { Verdict } from "./pipeline";
import type { Extracted, SubmissionInput } from "./schema";

/**
 * The community store: MongoDB Atlas, reached the same way `db()` reaches
 * Neon — null when unconfigured, and null is a supported state. A missing
 * store costs the feature, never the app.
 *
 * Free-tier Atlas for the test phase; the plan of record is GCP after
 * testing, which is why nothing outside `src/lib/community/` may import
 * the mongodb package — and why the route calls `insertSubmission` and
 * `applyVerdict` rather than touching a collection: the store swaps behind
 * this file, and only this file.
 */

export const SUBMISSIONS = "submissions";
const DB_NAME = "kranti";

/** The pantry's four tabs. "published" is a view over green documents — not a
 *  fifth status stored anywhere — so `listSubmissions` derives its filter
 *  from it rather than passing it straight through to `status`. */
export type PantryView = "pending" | "green" | "red" | "published";

/** The stored shape. `submission` is verbatim; everything else accretes beside it. */
export interface SubmissionDoc {
  _id?: ObjectId;
  status: "pending" | "green" | "red";
  created_at: Date;
  updated_at: Date;
  mode: "manual" | "image";
  submission: SubmissionInput;
  /** Image mode: what the model read, before the submitter corrected it.
   *  Client-supplied and unauthenticated — audit only, never a source of truth. */
  extracted?: Extracted;
  /** Audit only. The record's location IS the form's state; on any clash the form wins. */
  geo: Geo;
  verdict?: {
    card: "GREEN" | "RED";
    reasons: string[];
    model: string;
    at: Date;
    overridden_at?: Date;
  };
  dish?: { tag: string; aliases: string[]; language?: string };
  /** Set by an operator in the pantry, never by the model. The serving gate:
   *  only a green document carrying this is ever matched for a reader. */
  published_at?: Date;
}

/** What a route hands over. Status and timestamps are the store's to stamp. */
export type NewSubmission = Pick<SubmissionDoc, "mode" | "submission" | "geo" | "extracted">;

/** A row of the pantry list: no photo bytes, no contact — the detail view is where PII lives. */
export interface SubmissionSummary {
  id: string;
  status: SubmissionDoc["status"];
  mode: SubmissionDoc["mode"];
  created_at: Date;
  recipe_name: string;
  display_name: string;
  state: string;
  dish_tag: string | null;
  card: "GREEN" | "RED" | null;
  overridden: boolean;
  has_photo: boolean;
  published: boolean;
}

/** A whole document as the pantry reads it: `_id` becomes a hex `id`. */
export type StoredSubmission = Omit<SubmissionDoc, "_id"> & { id: string };

export const PAGE_SIZE = 30;

/** A 24-hex id or nothing; `new ObjectId` on anything else throws. */
function hexId(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

/**
 * Builds the connection string from the three env vars.
 *
 * ATLAS_URL is accepted in every shape Atlas hands out: a bare cluster host,
 * an `mongodb+srv://` string, or a standard `mongodb://host:port,...` string
 * with its query (ssl, replicaSet, authSource) — that query is kept, because
 * dropping it breaks the standard form. Credentials always come from their
 * own vars, so any embedded `user:pass@` is replaced, never trusted — and the
 * match runs to the last `@` before the path, so a password containing `@`
 * cannot eat the host.
 * Exported pure for the check script; `null` when anything is missing.
 */
export function atlasUri(
  url: string | undefined,
  user: string | undefined,
  pass: string | undefined,
): string | null {
  const u = url?.trim();
  const usr = user?.trim();
  const pwd = pass?.trim();
  if (!u || !usr || !pwd) return null;
  const m = /^(?:(mongodb(?:\+srv)?):\/\/)?(?:[^/?]*@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(u);
  if (!m) return null;
  const [, scheme, hosts, query] = m;
  // No scheme given: SRV unless a port is present, which SRV forbids.
  const srv = scheme ? scheme === "mongodb+srv" : !/:\d+/.test(hosts);
  const params = new URLSearchParams(query ?? "");
  if (!params.has("retryWrites")) params.set("retryWrites", "true");
  if (!params.has("w")) params.set("w", "majority");
  return `${srv ? "mongodb+srv" : "mongodb"}://${encodeURIComponent(usr)}:${encodeURIComponent(pwd)}@${hosts}/?${params.toString()}`;
}

function uri(): string | null {
  return atlasUri(process.env.ATLAS_URL, process.env.ATLAS_USER, process.env.ATLAS_PASSWORD);
}

/* Serverless instances are frozen and thawed; a module-level promise on
   globalThis survives hot reloads in dev and reuse in prod. */
const g = globalThis as unknown as { _communityClient?: Promise<MongoClient> | null };

export async function communityDb(): Promise<Db | null> {
  const connection = uri();
  if (!connection) return null;
  try {
    if (!g._communityClient) {
      g._communityClient = new MongoClient(connection, {
        serverSelectionTimeoutMS: 5000,
      }).connect();
    }
    const client = await g._communityClient;
    return client.db(DB_NAME);
  } catch (error) {
    console.error("[community] Atlas connection failed:", error);
    g._communityClient = null; // let the next request retry
    return null;
  }
}

/**
 * Store-size guard, not a per-reader limit (that is the route's `checkRate`).
 * The free tier is 512 MB and a photo is up to 500 KB, so an unguarded night
 * of scripted submissions fills it. Read per call so a test can set it.
 * `0` refuses everything; unset or unparseable means the default.
 */
export function dailyMax(): number {
  const raw = process.env.SUBMISSION_DAILY_MAX?.trim();
  const n = raw ? Number(raw) : 100;
  return Number.isFinite(n) && n >= 0 ? n : 100;
}

/**
 * Inserts as `pending` and returns the hex id. Null covers the store being
 * unavailable, the insert failing, and the daily ceiling — all three are
 * "not now" to the reader, and the log line says which.
 */
export async function insertSubmission(input: NewSubmission): Promise<string | null> {
  const db = await communityDb();
  if (!db) return null;
  try {
    const col = db.collection<SubmissionDoc>(SUBMISSIONS);
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // ponytail: count-then-insert can overshoot the ceiling by a request or
    // two under load; a store-size guard does not need better than that.
    const today = await col.countDocuments({ created_at: { $gte: dayStart } });
    if (today >= dailyMax()) {
      console.error(`[community] daily ceiling reached (${today}/${dailyMax()}); refusing insert`);
      return null;
    }
    const { insertedId } = await col.insertOne({
      ...input,
      status: "pending",
      created_at: now,
      updated_at: now,
    });
    return insertedId.toHexString();
  } catch (error) {
    console.error("[community] insert failed:", error);
    return null;
  }
}

/**
 * Writes the verdict and dish tag beside the submission. False leaves the doc
 * as it was: pending if the write failed, or exactly as the operator left it
 * if they have overridden this document — an override is final, and a late
 * `after()` callback or a re-run must not write over it.
 */
export async function applyVerdict(id: string, verdict: Verdict): Promise<boolean> {
  const _id = hexId(id);
  if (!_id) return false;
  const db = await communityDb();
  if (!db) return false;
  try {
    const at = new Date();
    const result = await db.collection<SubmissionDoc>(SUBMISSIONS).updateOne(
      { _id, "verdict.overridden_at": { $exists: false }, published_at: { $exists: false } },
      {
        $set: {
          status: verdict.card === "GREEN" ? "green" : "red",
          updated_at: at,
          verdict: { card: verdict.card, reasons: verdict.reasons, model: verdict.model, at },
          dish: { tag: verdict.dish_tag, aliases: verdict.aliases, language: verdict.language },
        },
      },
    );
    return result.matchedCount === 1;
  } catch (error) {
    console.error("[community] verdict update failed (doc stays as it was):", error);
    return false;
  }
}

/**
 * The human gate. A model verdict says a submission is not abusive; only an
 * operator says it may be served. Refuses anything that would put an
 * unreachable or unreviewed document on the site.
 */
export async function publishSubmission(
  id: string,
): Promise<"ok" | "not_found" | "not_green" | "no_tag" | "error"> {
  const _id = hexId(id);
  if (!_id) return "not_found";
  const db = await communityDb();
  if (!db) return "error";
  try {
    const col = db.collection<SubmissionDoc>(SUBMISSIONS);
    const doc = await col.findOne({ _id }, { projection: { status: 1, dish: 1 } });
    if (!doc) return "not_found";
    if (doc.status !== "green") return "not_green";
    // An untagged document matches nothing, so publishing it would put a recipe
    // in the Published list that no reader can ever reach. Overriding a pending
    // document to GREEN is how one gets made; re-running the verdict fixes it.
    if (!doc.dish?.tag) return "no_tag";
    // Filtered on the status the read just saw, so an override landing between
    // the two calls loses rather than leaving `published_at` on a red document.
    const at = new Date();
    const result = await col.updateOne(
      { _id, status: "green" },
      { $set: { published_at: at, updated_at: at } },
    );
    return result.matchedCount === 1 ? "ok" : "not_green";
  } catch (error) {
    console.error("[community] publish failed:", error);
    return "error";
  }
}

/**
 * The takedown. Unsets rather than nulls: `applyVerdict`'s guard tests for the
 * field's absence, so a null left behind would block every future verdict on
 * this document forever.
 */
export async function unpublishSubmission(id: string): Promise<"ok" | "not_found" | "error"> {
  const _id = hexId(id);
  if (!_id) return "not_found";
  const db = await communityDb();
  if (!db) return "error";
  try {
    const result = await db
      .collection<SubmissionDoc>(SUBMISSIONS)
      .updateOne({ _id }, { $unset: { published_at: "" }, $set: { updated_at: new Date() } });
    // Tri-state so the route can tell a stale id from an outage without
    // reading the whole document — contact and photo bytes included — back
    // out of the store just to learn that it exists.
    return result.matchedCount === 1 ? "ok" : "not_found";
  } catch (error) {
    console.error("[community] unpublish failed:", error);
    return "error";
  }
}

export async function listSubmissions(
  view: PantryView,
  page: number,
): Promise<{ rows: SubmissionSummary[]; total: number } | null> {
  const db = await communityDb();
  if (!db) return null;
  try {
    const col = db.collection<SubmissionDoc>(SUBMISSIONS);
    // "published" is a view over green documents, not a fourth status: a
    // published recipe still belongs in Green, and the Green list marks it
    // as published.
    const filter =
      view === "published"
        ? { status: "green" as const, published_at: { $exists: true } }
        : { status: view };
    const [total, docs] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter, {
          projection: {
            status: 1,
            mode: 1,
            created_at: 1,
            "submission.recipe_name": 1,
            "submission.display_name": 1,
            "submission.state": 1,
            "submission.photo.bytes": 1,
            "dish.tag": 1,
            "verdict.card": 1,
            "verdict.overridden_at": 1,
            published_at: 1,
          },
        })
        .sort({ created_at: -1 })
        .skip(Math.max(0, page) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
    ]);
    return {
      total,
      rows: docs.map((d) => ({
        id: String(d._id),
        status: d.status,
        mode: d.mode,
        created_at: d.created_at,
        recipe_name: d.submission.recipe_name,
        display_name: d.submission.display_name,
        state: d.submission.state,
        dish_tag: d.dish?.tag ?? null,
        card: d.verdict?.card ?? null,
        overridden: Boolean(d.verdict?.overridden_at),
        has_photo: Boolean(d.submission.photo?.bytes),
        published: Boolean(d.published_at),
      })),
    };
  } catch (error) {
    console.error("[community] list failed:", error);
    return null;
  }
}

/** The whole document, contact and photo included: the pantry's detail view is the one place for both. */
export async function getSubmission(id: string): Promise<StoredSubmission | null> {
  const _id = hexId(id);
  if (!_id) return null;
  const db = await communityDb();
  if (!db) return null;
  try {
    const doc = await db.collection<SubmissionDoc>(SUBMISSIONS).findOne({ _id });
    if (!doc) return null;
    const { _id: found, ...rest } = doc;
    return { ...rest, id: String(found) };
  } catch (error) {
    console.error("[community] read failed:", error);
    return null;
  }
}

/**
 * The operator outranks the model. Sets the status and stamps
 * `verdict.overridden_at`, which `applyVerdict` then refuses to write over —
 * so neither a late `after()` callback nor a re-run can undo a human decision.
 * A pending doc gets a verdict skeleton and, if it has no tag yet, one from
 * the recipe name, so a GREEN override is servable in Phase 4.
 */
export async function overrideVerdict(id: string, card: "GREEN" | "RED"): Promise<boolean> {
  const _id = hexId(id);
  if (!_id) return false;
  const db = await communityDb();
  if (!db) return false;
  try {
    const col = db.collection<SubmissionDoc>(SUBMISSIONS);
    const doc = await col.findOne({ _id }, { projection: { verdict: 1, dish: 1, "submission.recipe_name": 1 } });
    if (!doc) return false;
    const now = new Date();
    const verdict = { ...(doc.verdict ?? { reasons: [], model: "operator", at: now }), card, overridden_at: now };
    const dish = doc.dish ?? { tag: dishTag(doc.submission.recipe_name), aliases: [] };
    const status = card === "GREEN" ? "green" : "red";
    // A move to RED takes the recipe off the site in the same write: leaving
    // `published_at` behind would keep serving a document an operator just
    // rejected until the next unrelated write happened to touch it.
    await col.updateOne(
      { _id },
      card === "RED"
        ? { $set: { status, updated_at: now, verdict, dish }, $unset: { published_at: "" } }
        : { $set: { status, updated_at: now, verdict, dish } },
    );
    return true;
  } catch (error) {
    console.error("[community] override failed:", error);
    return false;
  }
}

/**
 * The thin Mongo query that feeds `phraseMatches` and `pickCommunity` — the
 * whole decision lives in `match.ts` as pure functions; this fetches the
 * candidates and flattens them into the shape those functions read.
 *
 * ponytail: in-memory phrase filter over the newest 200 published docs; move
 * the gate into the query with an aliases-array index if the store outgrows it.
 */
export async function matchCommunity(
  query: string,
  region: string | null,
  readerLang: string | null,
): Promise<{ chosen: CommunityMatch; others: string[]; total: number } | null> {
  // Normalize before touching Mongo: a reader who typed only punctuation
  // costs no round trip.
  const normalizedQuery = normalizeDish(query);
  if (!normalizedQuery) return null;
  const db = await communityDb();
  if (!db) {
    console.error("[community] match failed: no store");
    return null;
  }
  try {
    const col = db.collection<SubmissionDoc>(SUBMISSIONS);
    const docs = await col
      .find(
        { status: "green", published_at: { $exists: true }, "dish.tag": { $exists: true, $ne: "" } },
        {
          projection: {
            dish: 1,
            published_at: 1,
            created_at: 1,
            "submission.recipe_name": 1,
            "submission.display_name": 1,
            "submission.belongs_to": 1,
            "submission.belongs_to_other": 1,
            "submission.state": 1,
            "submission.city": 1,
            "submission.story": 1,
            "submission.ingredients": 1,
            "submission.method": 1,
            "submission.photo.mime": 1,
            "submission.photo.bytes": 1,
            // Neither submission.contact nor submission.photo.data is
            // projected here: the first is a member of the public's contact
            // details, the second is up to 500 KB of base64 served from its
            // own route.
          },
        },
      )
      .sort({ published_at: -1 })
      .maxTimeMS(2000)
      .limit(200)
      .toArray();

    const matches: CommunityMatch[] = docs
      .filter((d) => phraseMatches(normalizedQuery, d.dish?.tag ?? "", d.dish?.aliases ?? []))
      .map((d) => ({
        id: String(d._id),
        state: d.submission.state,
        language: d.dish?.language || null,
        published_at: d.published_at as Date,
        created_at: d.created_at,
        dish: { tag: d.dish?.tag ?? "", aliases: d.dish?.aliases ?? [] },
        submission: {
          recipe_name: d.submission.recipe_name,
          display_name: d.submission.display_name,
          belongs_to: d.submission.belongs_to,
          belongs_to_other: d.submission.belongs_to_other,
          city: d.submission.city,
          story: d.submission.story,
          ingredients: d.submission.ingredients,
          method: d.submission.method,
          photo: d.submission.photo ? { mime: d.submission.photo.mime, bytes: d.submission.photo.bytes } : undefined,
        },
      }));

    if (!matches.length) return null;
    const chosen = pickCommunity(matches, region, readerLang);
    if (!chosen) return null;

    // The other states a reader could have been served, in first-seen order,
    // excluding the chosen row's own state. Built in code from the match
    // list — never by a model, which writes no citation here either.
    const others: string[] = [];
    for (const m of matches) {
      if (m.id === chosen.id || m.state === chosen.state || others.includes(m.state)) continue;
      others.push(m.state);
    }

    return { chosen, others, total: matches.length };
  } catch (error) {
    console.error("[community] match failed:", error);
    return null;
  }
}
