import { MongoClient, type Db } from "mongodb";

/**
 * The community store: MongoDB Atlas, reached the same way `db()` reaches
 * Neon — null when unconfigured, and null is a supported state. A missing
 * store costs the feature, never the app.
 *
 * Free-tier Atlas for the test phase; the plan of record is GCP after
 * testing, which is why nothing outside `src/lib/community/` may import
 * the mongodb package: the store swaps behind this file.
 */

export const SUBMISSIONS = "submissions";
const DB_NAME = "kranti";

/**
 * Builds the connection string from the three env vars.
 *
 * ATLAS_URL is accepted in every shape Atlas hands out: a bare cluster host,
 * an `mongodb+srv://` string, or a standard `mongodb://host:port,...` string
 * with its query (ssl, replicaSet, authSource) — that query is kept, because
 * dropping it breaks the standard form. Credentials always come from their
 * own vars, so any embedded `user:pass@` is replaced, never trusted.
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
  const m = /^(?:(mongodb(?:\+srv)?):\/\/)?(?:[^@/]*@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(u);
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
