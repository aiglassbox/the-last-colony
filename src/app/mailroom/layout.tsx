import type { Metadata } from "next";

import "../kitchen/kitchen.css";
import "./mailroom.css";

/**
 * The mailroom wears the kitchen's shell: same palette, same panels. Like the
 * other doors it is kept out of search results by the meta tag and robots.txt
 * both. Neither is a security control; the password is.
 */
export const metadata: Metadata = {
  title: "The Mailroom — The Kranti Cookbook",
  robots: { index: false, follow: false, nocache: true },
};

export default function MailroomLayout({ children }: { children: React.ReactNode }) {
  return <div className="kitchen">{children}</div>;
}
