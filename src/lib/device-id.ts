/**
 * The id this browser files its threads under.
 *
 * It lived in `chat/sync.ts`, which carries a `"use client"` directive — fine
 * while the thread mirror was its only caller, and wrong the moment the
 * analytics shim needed it too: `analytics.ts` is imported by route handlers,
 * and a server module reaching through a client boundary gets a reference
 * proxy rather than a function. So the implementation moved here, to a module
 * with no directive and no imports, and `sync.ts` re-exports it. One
 * definition, one storage key, and no way for the mirror and the event log to
 * disagree about who a device is.
 *
 * Not a security boundary, and never treated as one — see the note in
 * `api/conversations/route.ts`.
 */

const DEVICE_KEY = "tlc.device.v1";

export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode with storage disabled. No id, so no mirror and no join.
    return null;
  }
}
