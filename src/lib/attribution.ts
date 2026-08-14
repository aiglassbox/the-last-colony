/**
 * Where a visitor came from.
 *
 * A pixel tells the ad platform what happened; it does not tell *this* codebase
 * anything. This module is the first-party half: it reads the campaign markers
 * off the landing URL once, keeps them for the session, and hands them to every
 * beacon that follows. That is what turns a log line from "someone opened a
 * source drawer" into "someone who arrived from the Diwali reel opened a source
 * drawer".
 *
 * First write wins. A reader who lands on an ad link and then navigates to a
 * dish page has no query string on the second request, and re-reading there
 * would erase the origin that made the visit worth counting.
 */

import type { EventProps } from "@/lib/analytics";

/**
 * The markers worth keeping.
 *
 * The five `utm_*` are the campaign's own labels. The `*clid` are the ad
 * platforms' click identifiers — a single click, attributable back to the
 * placement that paid for it — and `fbclid` in particular is what Meta matches
 * a conversion against when a browser refuses third-party cookies.
 */
const AD_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
] as const;

const STORAGE_KEY = "kc:attribution";
const VISIT_KEY = "kc:visit-recorded";

/** The route handler clamps at 200; clamping here keeps the beacon small too. */
const MAX_VALUE_CHARS = 200;

export type Attribution = Readonly<Record<string, string>>;

/**
 * Storage can throw rather than return null — Safari in private mode, and any
 * browser with site data switched off. A visitor who has disabled storage still
 * gets counted, they just get counted per page rather than per session, so the
 * module keeps its own copy and treats `sessionStorage` as the durable tier
 * rather than the only one.
 */
let memo: Attribution | null = null;

function readStored(): Attribution | null {
  if (memo) return memo;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    memo = parsed as Attribution;
    return memo;
  } catch {
    return null;
  }
}

function writeStored(value: Attribution): void {
  memo = value;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The in-memory copy above is the fallback. Attribution is never worth an
    // exception on a page that is otherwise fine.
  }
}

/** Host only. The full referrer URL is more of a stranger's reading history than a campaign needs. */
function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const { hostname } = new URL(referrer);
    return hostname === window.location.hostname ? null : hostname;
  } catch {
    return null;
  }
}

function read(search: string, referrer: string, pathname: string): Attribution {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};

  for (const key of AD_PARAMS) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, MAX_VALUE_CHARS);
  }

  const host = referrerHost(referrer);
  if (host) out.referrer = host;
  out.landing = pathname.slice(0, MAX_VALUE_CHARS);

  return out;
}

/**
 * Read the campaign markers off this session's first page, or return the set
 * already captured. Safe to call on every mount.
 */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};

  const stored = readStored();
  if (stored) return stored;

  const fresh = read(window.location.search, document.referrer, window.location.pathname);
  writeStored(fresh);
  return fresh;
}

/**
 * What rides along on every beacon.
 *
 * Captures rather than reads-or-gives-up, because effects run children first
 * and `VisitTracker` is mounted after them: a component that beacons from its
 * own mount effect would otherwise send the one event of the session that had
 * no campaign markers on it. First write still wins, so calling this early is
 * the capture and every call after it is a read.
 */
export function getAttribution(): EventProps {
  if (typeof window === "undefined") return {};
  return { ...captureAttribution() };
}

/**
 * A printed QR code cannot carry a referrer, so the campaign has to label it in
 * the URL itself. Either marker works: `?utm_source=qr` for a link that is also
 * a UTM-tagged placement, or a bare `?qr=` for one that is not.
 */
export function isQrEntry(attribution: Attribution): boolean {
  const marked = attribution.utm_source === "qr" || attribution.utm_medium === "qr";
  if (marked) return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("qr");
}

/**
 * One visit record per session, not per page load.
 *
 * The pixel already fires a PageView on every route, so a second per-page
 * first-party event would only duplicate it. The question this one answers is
 * "how many people arrived, and from where", which is asked once.
 */
export function claimVisit(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(VISIT_KEY)) return false;
    window.sessionStorage.setItem(VISIT_KEY, "1");
    return true;
  } catch {
    // Storage refused. Counting a visit per page load overstates the number,
    // but silently counting none understates it to zero, which is worse.
    return true;
  }
}
