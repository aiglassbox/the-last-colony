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

export function db(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  cached ??= neon(url);
  return cached;
}
