/**
 * A fixed-window limiter on the endpoints that spend model quota.
 *
 * The supplied Gemini key is on the free tier: 20 requests per day, per model.
 * Both model-calling routes are unauthenticated and `force-dynamic`, so until
 * now anyone who found the URL could spend a day's quota in about ten seconds,
 * and the reader who did name a dish would get the quota error rather than a
 * card. A limiter is not security here, it is the difference between the
 * campaign being up and being down.
 *
 * Deliberately in-memory, and the limits of that are worth stating plainly: it
 * resets when the process does and it does not span instances, so on more than
 * one node each gets its own allowance. For a single-node campaign site that is
 * the right trade against a Redis dependency. If this is ever scaled out, this
 * file is the thing that has to move, not the routes that call it.
 */

interface Window {
  count: number;
  /** When the window opened, in ms. */
  start: number;
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 12;

/**
 * The allowance for callers we cannot tell apart.
 *
 * Behind a proxy that sets a forwarding header every caller has their own
 * window. With no such header there is nothing in a route handler to tell two
 * readers apart, so they shared one key — and that key was sized for one
 * person. Twelve requests in five minutes, for everybody at once: the
 * thirteenth reader of the day got the limiter, and the campaign was down
 * without a single thing having gone wrong.
 *
 * The fallback cannot be removed, because there is genuinely nothing else to
 * key on. What it can be is sized for what it actually is — a pool, not a
 * person. A script in a loop still hits this in well under a minute, which is
 * what the limiter is for; a launch-day crowd does not.
 */
const MAX_SHARED_WINDOW = 240;

/** The key used when no header identifies the caller. */
const SHARED_KEY = "unidentified";

/** Windows are only kept while live; a sweep runs when the map gets big. */
const SWEEP_AT = 5000;

const windows = new Map<string, Window>();

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.start >= WINDOW_MS) windows.delete(key);
  }
}

export interface RateVerdict {
  ok: boolean;
  /** Seconds until the window rolls over. Only meaningful when `ok` is false. */
  retryAfter: number;
}

/**
 * The caller's identity, as far as an unauthenticated endpoint can know it.
 *
 * `x-forwarded-for` is client-controlled and trivially spoofed, which is fine
 * for what this defends against: it stops a script hammering the endpoint and
 * accidental loops, not a determined attacker, and nothing behind it is
 * sensitive. The leftmost entry is the original client where a trusted proxy
 * appends, so it is the one taken.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;

  warnUnidentified();
  return SHARED_KEY;
}

/**
 * Said once, not per request.
 *
 * A deployment whose proxy does not forward the client address puts every
 * reader in one pool, and that is a decision someone should make knowingly
 * rather than discover from a graph. Once per process is enough to put it in
 * the deploy log; every request would bury it.
 */
let warned = false;
function warnUnidentified(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[rate-limit] no x-forwarded-for or x-real-ip on an incoming request. " +
      `Callers cannot be told apart and share one allowance of ${MAX_SHARED_WINDOW} ` +
      `per ${WINDOW_MS / 60000} minutes. Set the header at the proxy to give each ` +
      "reader their own.",
  );
}

export function checkRate(key: string, now = Date.now()): RateVerdict {
  if (windows.size > SWEEP_AT) sweep(now);

  // A pool of unknown callers is not one caller, and must not be held to one
  // caller's allowance.
  const max = key === SHARED_KEY ? MAX_SHARED_WINDOW : MAX_PER_WINDOW;

  const existing = windows.get(key);
  if (!existing || now - existing.start >= WINDOW_MS) {
    windows.set(key, { count: 1, start: now });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      ok: false,
      retryAfter: Math.ceil((existing.start + WINDOW_MS - now) / 1000),
    };
  }
  return { ok: true, retryAfter: 0 };
}

/** Exposed so the limits can be stated in tests and error copy. */
export const RATE_LIMIT = {
  windowMs: WINDOW_MS,
  max: MAX_PER_WINDOW,
  sharedMax: MAX_SHARED_WINDOW,
  sharedKey: SHARED_KEY,
};
