import type { Metadata } from "next";

import "./kitchen.css";

/**
 * The dashboard's own shell.
 *
 * `robots: noindex, nofollow` here as well as in `robots.txt`, and the
 * duplication is deliberate: robots.txt is a request that well-behaved
 * crawlers honour and a map of interesting URLs for the ones that do not, while
 * the meta tag travels with the page itself. Neither is a security control —
 * the password is — but a dashboard that turns up in a search result has
 * already told the world it exists.
 */
export const metadata: Metadata = {
  title: "The Kitchen — The Kranti Cookbook",
  robots: { index: false, follow: false, nocache: true },
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <div className="kitchen">{children}</div>;
}
