"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Google Analytics 4, via gtag.js.
 *
 * The ID is configuration, not source, for the same reason the pixel's is: a
 * hardcoded ID reports every laptop and every preview deploy into the
 * production property. Unset means off.
 *
 * Unlike the pixel, no route-change tracking is done here. GA4's enhanced
 * measurement ("page changes based on browser history events", on by default)
 * already fires a page_view on client-side navigation; sending one as well
 * would count every dish twice.
 *
 * The admin routes are skipped so the dashboards do not appear in their own
 * numbers (AGENTS.md, "Reading the numbers"). An operator arrives at /kitchen
 * or /pantry by typing the URL — a hard load — so the script is never loaded
 * there in the first place.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/** A GA4 measurement ID. Checked before interpolation so a CI variable cannot become an injection point. */
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

export function GoogleAnalytics() {
  const pathname = usePathname();

  if (!GA_ID || !GA_ID_PATTERN.test(GA_ID)) return null;
  if (pathname.startsWith("/kitchen") || pathname.startsWith("/pantry")) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`,
        }}
      />
    </>
  );
}
