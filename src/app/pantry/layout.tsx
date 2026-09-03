import type { Metadata } from "next";

import "../kitchen/kitchen.css";
import "./pantry.css";

/**
 * The pantry wears the kitchen's shell — same palette, same panels — and like
 * it is kept out of search results by the meta tag and robots.txt both.
 * Neither is a security control; the password is.
 */
export const metadata: Metadata = {
  title: "The Pantry — The Kranti Cookbook",
  robots: { index: false, follow: false, nocache: true },
};

export default function PantryLayout({ children }: { children: React.ReactNode }) {
  return <div className="kitchen pantry">{children}</div>;
}
