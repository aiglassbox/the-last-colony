import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Swadeshi Rasooi AI — The Great Indian Food Restoration",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#131211" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because the script below writes `data-theme`
    // onto <html> before React hydrates, which is the point of it.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
