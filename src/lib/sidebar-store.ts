"use client";

/**
 * Sidebar collapse state, as an external store.
 *
 * Same shape as the theme store, and for the same reason: the preference lives
 * in localStorage, which is an external system, so reading it through
 * `useSyncExternalStore` gives a stable server snapshot to hydrate against
 * instead of setting state from an effect on mount.
 *
 * The default is width-dependent — a narrow viewport starts collapsed, because
 * a 288px rail on a 375px screen leaves nothing for the conversation.
 */

const KEY = "tlc.sidebar.collapsed";
const COMPACT = "(max-width: 991px)";

const listeners = new Set<() => void>();
let state: boolean | null = null;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): boolean {
  if (state === null) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    state =
      stored === "true" ? true : stored === "false" ? false : window.matchMedia(COMPACT).matches;
  }
  return state;
}

/** Expanded on the server; the client corrects on hydration. */
export function getServerSnapshot(): boolean {
  return false;
}

export function setCollapsed(next: boolean): void {
  if (state === next) return;
  state = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // A full or disabled localStorage must not break the toggle.
  }
  for (const listener of listeners) listener();
}

export function toggleCollapsed(): void {
  setCollapsed(!getSnapshot());
}
