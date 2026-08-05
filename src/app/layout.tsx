import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

/**
 * Two faces, as supplied with the design.
 *
 * Poppins carries everything you read; Salty Ages carries the one line you
 * look at. The display face is licensed and not on Google Fonts, so it is
 * bundled locally as woff2 and subset to the headline's needs.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const saltyAges = localFont({
  src: "./fonts/salty-ages.woff2",
  variable: "--font-display",
  display: "swap",
  // Poppins is metrically nothing like Salty Ages, but it is what is already
  // loading, so the swap costs no extra request.
  fallback: ["Georgia", "serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Asli Rasoi — The Great Indian Food Restoration",
  description:
    "Name a dish you eat every week. See what it was before colonial-era crop policy and industrial milling rewrote it — and how to cook that version tonight.",
  openGraph: {
    title: "The Great Indian Food Restoration",
    description:
      "Your idli is a rice cake. It did not begin as one. A restoration project for the Indian plate.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#4a100d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // One theme, so there is no pre-paint script and no `data-theme` to write.
  return (
    <html lang="en" className={`${poppins.variable} ${saltyAges.variable}`}>
      <body>{children}</body>
    </html>
  );
}
