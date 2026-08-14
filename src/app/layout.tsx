import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

/**
 * Two faces.
 *
 * New Spirit carries the headline — the supplied display face, a contemporary
 * high-contrast serif. It is licensed and not on Google Fonts, so both weights
 * are bundled locally; the files arrived named .ttf but are OpenType/CFF, and
 * are renamed so the loader declares the right format.
 *
 * Regular is the headline weight. Medium stays registered at 500 for the card
 * verdict, which is set small enough to want the extra weight.
 *
 * Poppins carries everything you operate: it is the sans in the comps, and its
 * evenness is what keeps the illustrated ground legible.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const newSpirit = localFont({
  src: [
    { path: "./fonts/new-spirit-regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/new-spirit-medium.otf", weight: "500", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["Iowan Old Style", "Georgia", "serif"],
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
    <html lang="en" className={`${poppins.variable} ${newSpirit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
