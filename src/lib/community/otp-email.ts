import { siteUrl } from "@/lib/site-url";
import { SOCIALS, type Network } from "@/lib/social";

import { OTP } from "./otp-rules";

/**
 * The verification email: subject, HTML and plain text, built from the code
 * alone.
 *
 * Pure — no Resend, no store, nothing read but `siteUrl()` — so
 * `scripts/check-otp.ts` pins it offline, and `deliver()` in `otp.ts` only
 * sends what this returns.
 *
 * It is built the way mail clients need rather than the way the site is:
 * tables and inline styles, because Gmail and Outlook drop most of anything
 * else; PNGs, because neither renders SVG; absolute image URLs, because an
 * email has no origin of its own; and alt text on every image, because many
 * clients hold images until the reader asks, and the email has to read
 * correctly before they do. The 600px table sits in an MSO ghost table because
 * desktop Outlook ignores `max-width`. The plain-text part stays for every client that
 * shows no HTML at all.
 *
 * No tracking pixel and no campaign markers on the links: this is the
 * transactional mail someone asked for, not a campaign, and the off-site links
 * stay clean for the reason `email/destinations.ts` gives.
 */

/* The home page's palette, as literals: an email cannot read the site's CSS
   variables. Named after the tokens they copy in globals.css. */
const GROUND = "#2c441e"; // --ground
const CREAM = "#f8a81b"; // --cream
const INK = "#214513"; // --on-cream
const MUTED = "#55703f"; // --field-muted
const CARD = "#ffffff";

const SANS = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'Courier New', Courier, monospace";

/* The lockup is 240 px wide on disk and shown at half that, so it stays sharp
   on a dense screen; the height keeps the file's own aspect. */
const LOGO_W = 120;
const LOGO_H = 100;
const ICON = 36;

const NAMES: Record<Network, string> = { instagram: "Instagram", youtube: "YouTube", x: "X" };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function otpEmail(code: string): { subject: string; html: string; text: string } {
  const origin = siteUrl();
  // `siteUrl()` only checks the scheme, and a malformed `SITE_URL` must not
  // throw here and fail every send under a misleading "resend call failed" log.
  const host = origin.replace(/^https?:\/\//, "");
  const minutes = OTP.lifeMs / 60_000;
  const span = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const expiry = `This code expires in ${span}.`;
  const c = esc(code);

  const icons = SOCIALS.map(
    (s) =>
      `<td style="padding:0 6px;"><a href="${esc(s.href)}" target="_blank" style="text-decoration:none;">` +
      `<img src="${esc(`${origin}/email-assets/social-${s.network}.png`)}" width="${ICON}" height="${ICON}" ` +
      `alt="${esc(NAMES[s.network])}" style="display:block;border:0;width:${ICON}px;height:${ICON}px;` +
      `color:${CREAM};font:12px ${SANS};"></a></td>`,
  ).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Your Kranti Cookbook code</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your code is ${c}. It expires in ${span}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td align="center" style="padding:0 0 24px;">
<a href="${esc(origin)}" target="_blank" style="text-decoration:none;"><img src="${esc(`${origin}/email-assets/kranti-logo.png`)}" width="${LOGO_W}" height="${LOGO_H}" alt="Kranti Cookbook" style="display:block;border:0;width:${LOGO_W}px;height:auto;color:${CREAM};font:bold 22px ${SERIF};"></a>
</td></tr>
<tr><td bgcolor="${CARD}" style="background:${CARD};border-radius:8px;padding:40px 32px;font-family:${SANS};color:${INK};">
<h1 style="margin:0 0 12px;font:bold 24px/1.3 ${SERIF};color:${INK};">Verify your email</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:${INK};">Enter this code on Kranti Cookbook to finish submitting your recipe.</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
<tr><td align="center" style="border:2px solid ${CREAM};border-radius:8px;padding:16px 20px 16px 28px;font:bold 32px/1 ${MONO};letter-spacing:8px;color:${INK};">${c}</td></tr>
</table>
<p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:${INK};">${expiry}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${INK};">Never share it. Kranti Cookbook will never ask you for it.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};">Didn&#39;t ask for this? You can ignore this email; nothing happens without the code.</p>
</td></tr>
<tr><td align="center" style="padding:28px 0 0;font-family:${SANS};color:${CREAM};">
<p style="margin:0 0 12px;font-size:14px;letter-spacing:0.04em;color:${CREAM};">Follow Kranti Cookbook</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>${icons}</tr></table>
<p style="margin:16px 0 0;font-size:13px;"><a href="${esc(origin)}" target="_blank" style="color:${CREAM};text-decoration:none;">${esc(host)}</a></p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Your Kranti Cookbook code is ${code}. ${expiry}`,
    "",
    "Enter it on Kranti Cookbook to finish submitting your recipe. Never share it; Kranti Cookbook will never ask you for it.",
    "",
    "If you did not ask for this, ignore this email.",
    "",
    "Follow Kranti Cookbook:",
    ...SOCIALS.map((s) => `${NAMES[s.network]}: ${s.href}`),
  ].join("\n");

  return { subject: `Your Kranti Cookbook code: ${code}`, html, text };
}
