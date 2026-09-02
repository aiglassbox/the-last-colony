import { MongoClient, ObjectId, type Db } from "mongodb";

import type { Geo } from "../events/geo";
import type { Verdict } from "./pipeline";
import type { SubmissionInput } from "./schema";

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

/** The stored shape. `submission` is verbatim; everything else accretes beside it. */
export interface SubmissionDoc {
  _id?: ObjectId;
  status: "pending" | "green" | "red";
  created_at: Date;
  updated_at: Date;
  mode: "manual" | "image";
  submission: SubmissionInput;
  /** Audit only. The record's location IS the form's state; on any clash the form wins. */
  geo: Geo;
  verdict?: {
    card: "GREEN" | "RED";
    reasons: string[];
    model: string;
    at: Date;
    overridden_at?: Date;
  };
  dish?: { tag: string; aliases: string[] };
}

/** What a route hands over. Status and timestamps are the store's to stamp. */
export type NewSubmission = Pick<SubmissionDoc, "mode" | "submission" | "geo">;

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
function dailyMax(): number {
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

/** Writes the verdict and dish tag beside the submission. False leaves the doc pending. */
export async function applyVerdict(id: string, verdict: Verdict): Promise<boolean> {
  const db = await communityDb();
  if (!db) return false;
  try {
    const at = new Date();
    await db.collection<SubmissionDoc>(SUBMISSIONS).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: verdict.card === "GREEN" ? "green" : "red",
          updated_at: at,
          verdict: { card: verdict.card, reasons: verdict.reasons, model: verdict.model, at },
          dish: { tag: verdict.dish_tag, aliases: verdict.aliases },
        },
      },
    );
    return true;
  } catch (error) {
    console.error("[community] verdict update failed (doc stays pending):", error);
    return false;
  }
}
