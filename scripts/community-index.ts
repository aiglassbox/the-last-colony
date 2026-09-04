/**
 * One-off: the indexes the pantry list and the daily ceiling read by.
 *
 *   npm run community:index      (loads .env itself; run once per environment)
 *
 * Idempotent — createIndex is a no-op when the index already exists. Not part
 * of `npm run check` because it needs the store.
 */
import { communityDb, SUBMISSIONS } from "../src/lib/community/client";

(async () => {
  const db = await communityDb();
  if (!db) {
    console.error("community-index: ATLAS_* unset or the store is unreachable");
    process.exit(1);
  }
  const col = db.collection(SUBMISSIONS);
  console.log("created", await col.createIndex({ created_at: -1 }, { name: "created_at_desc" }));
  console.log("created", await col.createIndex({ status: 1, created_at: -1 }, { name: "status_created_at" }));
  console.log("created", await col.createIndex({ status: 1, published_at: -1 }, { name: "published_recent" }));
  console.log("created", await col.createIndex({ status: 1, published_at: -1, "dish.tag": 1 }, { name: "served_dish" }));
  console.log(
    "indexes now:",
    (await col.indexes()).map((i) => i.name).join(", "),
  );
  process.exit(0);
})();
