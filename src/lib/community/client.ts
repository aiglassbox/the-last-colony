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

function uri(): string | null {
  const url = process.env.ATLAS_URL?.trim();
  const user = process.env.ATLAS_USER?.trim();
  const pass = process.env.ATLAS_PASSWORD?.trim();
  if (!url || !user || !pass) return null;
  // ATLAS_URL may or may not carry the scheme; normalise to the SRV form.
  const host = url.replace(/^mongodb(\+srv)?:\/\//, "").replace(/\/.*$/, "");
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/?retryWrites=true&w=majority`;
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
