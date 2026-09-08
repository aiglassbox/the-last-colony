/**
 * One-off: the indexes the pantry list and the daily ceiling read by.
 *
 *   npm run community:index      (loads .env itself; run once per environment)
 *
 * Idempotent — createIndex is a no-op when the index already exists. Not part
 * of `npm run check` because it needs the store.
 */
import { communityDb, SUBMISSIONS, TRANSLATIONS } from "../src/lib/community/client";
import { OTP_CODES } from "../src/lib/community/otp";

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

  const tcol = db.collection(TRANSLATIONS);
  console.log("created", await tcol.createIndex({ submission_id: 1, lang: 1 }, { name: "submission_lang", unique: true }));
  console.log(
    "translation indexes now:",
    (await tcol.indexes()).map((i) => i.name).join(", "),
  );

  const ocol = db.collection(OTP_CODES);
  console.log("created", await ocol.createIndex({ email: 1 }, { name: "email", unique: true }));
  // An hour after the last touch: a verified document must outlive its
  // five-minute code by the fifteen-minute hold, with room to spare.
  // Re-running this script is idempotent, but re-tuning is not: createIndex
  // with the same name and a different expireAfterSeconds throws
  // IndexOptionsConflict — changing the hour later needs collMod instead.
  console.log("created", await ocol.createIndex({ updated_at: 1 }, { name: "ttl", expireAfterSeconds: 3600 }));
  console.log(
    "otp indexes now:",
    (await ocol.indexes()).map((i) => i.name).join(", "),
  );
  process.exit(0);
})();
