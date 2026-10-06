import type { Metadata } from "next";

import "../kitchen/kitchen.css";

/**
 * The recipe box wears the kitchen's shell — same palette, same panels — and
 * like the other two doors is kept out of search results by the meta tag and
 * robots.txt both. Neither is a security control; the password is.
 */
export const metadata: Metadata = {
  title: "The Recipe Box — The Kranti Cookbook",
  robots: { index: false, follow: false, nocache: true },
};

export default function RecipeBoxLayout({ children }: { children: React.ReactNode }) {
  return <div className="kitchen">{children}</div>;
}
