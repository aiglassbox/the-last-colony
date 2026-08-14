"use client";

import { useEffect } from "react";

import { trackClient } from "@/lib/analytics";
import { captureAttribution, claimVisit, isQrEntry } from "@/lib/attribution";

/**
 * Records the arrival.
 *
 * Renders nothing and exists for its effect: capture the campaign markers off
 * the landing URL before the first navigation can strip them, then write one
 * `visit` line so the log answers "how many came, and from which placement"
 * without a round trip to Ads Manager.
 *
 * It runs in an effect rather than during render because the query string and
 * `document.referrer` do not exist on the server, and because a beacon fired
 * during render would fire again on every re-render.
 */
export function VisitTracker() {
  useEffect(() => {
    const attribution = captureAttribution();

    // Attribution is attached to every beacon by `trackClient`, so `visit`
    // carries the full set without naming any of it here.
    if (claimVisit()) trackClient("visit");

    // `qr_entry` has been in the event union since before there was anything to
    // fire it. A printed code is the one placement with no referrer and no
    // click ID, so the URL marker is the only evidence it leaves.
    if (isQrEntry(attribution)) trackClient("qr_entry");
  }, []);

  return null;
}
