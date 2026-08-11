import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Poppins } from "next/font/google";

import "./globals.css";

/**
 * Two faces.
 *
 * Cormorant Garamond carries the headline — a high-contrast old-style serif,
 * which is what makes the page read as a printed manuscript rather than a
 * product page. Poppins carries everything you operate: it is the sans in the
 * comps, and its evenness is what keeps the illustrated ground legible.
 *
 * The licensed display face used by the previous design is gone with it.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "The Kranti Cookbook",
  description:
    "Name a dish you eat every week. See what it was before colonial-era crop policy and industrial milling rewrote it — and how to cook that version tonight.",
  openGraph: {
    title: "The Kranti Cookbook",
    description:
      "Your idli is a rice cake. It did not begin as one. A restoration project for the Indian plate.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#8a1c14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // One theme, so there is no pre-paint script and no `data-theme` to write.
  return (
    <html lang="en" className={`${poppins.variable} ${cormorant.variable}`}>
      <body>{children}</body>
    </html>
  );
}
