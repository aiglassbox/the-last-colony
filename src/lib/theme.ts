"use client";

/**
 * Theme state, as an external store.
 *
 * The source of truth is the `data-theme` attribute on <html>, which the
 * inline script in layout.tsx sets before first paint — so there is no flash
 * of the wrong theme, and React never has to own the initial value. This store
 * just makes that attribute readable and subscribable from components.
 */

export type Theme = "light" | "dark";

const KEY = "tlc.theme";

const listeners = new Set<() => void>();
let snapshot: Theme = "light";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** What the pre-paint script decided, or the OS preference if it did not run. */
function readFromDom(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  return systemPrefersDark() ? "dark" : "light";
}

let initialised = false;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Theme {
  if (!initialised) {
    snapshot = readFromDom();
    initialised = true;
  }
  return snapshot;
}

/** Server render is always light; the pre-paint script corrects it instantly. */
export function getServerSnapshot(): Theme {
  return "light";
}

export function setTheme(next: Theme): void {
  snapshot = next;
  initialised = true;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // A full or disabled localStorage must not break the toggle.
  }
  for (const listener of listeners) listener();
}

export function toggleTheme(): void {
  setTheme(getSnapshot() === "dark" ? "light" : "dark");
}

/**
 * Inlined into <head> and run before first paint, so the correct theme is on
 * <html> before anything renders. Kept as a string because it must not wait
 * for the React bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  KEY,
)});var d=s==="dark"||(!s&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;
