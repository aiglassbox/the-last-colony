import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The database handle, or null when there is no `DATABASE_URL`.
 *
 * Null is a supported state, not a failure. Threads are written to the device
 * first and mirrored here second, so a missing database costs the mirror and
 * nothing else — the same posture the model key has, where the absence of one
 * loses the prose and leaves every card standing.
 *
 * The pooled connection string is the one to use: route handlers are invoked
 * per request and would otherwise open a connection each time.
 */
let cached: NeonQueryFunction<false, false> | null = null;

/**
 * The deployment names these with a `Last_Colony_` prefix, because one Vercel
 * project holds more than one integration's variables. Local `.env` files use
 * the bare name. Both are read rather than picking one, so neither environment
 * has to rename anything — and a mirror that silently does nothing in
 * production because it read the wrong key is exactly the failure this cannot
 * afford, since the app looks identical either way.
 */
function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.Last_Colony_DATABASE_URL;
}

export function db(): NeonQueryFunction<false, false> | null {
  const url = connectionString();
  if (!url) return null;
  cached ??= neon(url);
  return cached;
}
