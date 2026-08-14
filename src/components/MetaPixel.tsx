"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackPixelPageView } from "@/lib/meta-pixel";

/**
 * The Meta Pixel.
 *
 * The ID is configuration, not source. A pixel hardcoded here fires from every
 * developer's laptop and every preview deploy into the same ad account as
 * production, and the campaign then optimises against a dataset with the team's
 * own testing mixed into it. Unset means off, which is what a local run and CI
 * both want.
 *
 * The published snippet is reproduced faithfully below with one exception noted
 * at the loader line. Do not "tidy" it — it is Meta's, and its shape is what
 * their debugger recognises.
 */
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/**
 * A pixel ID is a numeric dataset ID. Checking that before interpolating it
 * into an inline `<script>` is the difference between a config value and an
 * injection point: the env var is trusted today because a person set it, and
 * this keeps that true when it is set from a CI variable nobody reviews.
 */
const PIXEL_ID_PATTERN = /^\d{10,20}$/;

function baseCode(id: string): string {
  // The one deviation from the copy-paste snippet: `n.queue.push` is reached
  // via `callMethod` on the loaded library, so the loader URL has to be the
  // real one. `https://facebook.net` is not a script.
  return `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${id}');
fbq('track', 'PageView');`;
}

export function MetaPixel() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  /**
   * The snippet fires one PageView, on load. Every navigation after that is a
   * client-side route change the pixel never hears about, so a reader who lands
   * on the home page and opens four dishes would register as a single page
   * view. Skipping the first render is what keeps that initial one from being
   * counted twice.
   */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    trackPixelPageView();
  }, [pathname]);

  if (!PIXEL_ID || !PIXEL_ID_PATTERN.test(PIXEL_ID)) return null;

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: baseCode(PIXEL_ID) }}
      />
      <noscript>
        {/* The no-JS fallback is a real image request, and next/image would
            defeat the point by deferring it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
