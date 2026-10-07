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
 * else; PNGs, because neither renders SVG; and alt text on every image, because
 * some clients hold remote images until the reader asks, and the email has to
 * read correctly before they do.
 *
 * The images are PNGs on the site (`public/email-assets/`, made by
 * `scripts/make-email-assets.ts`), linked by absolute URL. That is what makes
 * them quick: Gmail fetches remote images through its image proxy and caches
 * them, so after the first open they show almost at once, and `next.config.ts`
 * gives `/email-assets/` a week's cache so the proxy keeps its copy instead of
 * asking again on every open. Inline (CID) attachments were tried; they need no
 * deploy, but Gmail fetched every one afresh for every email, a second or two
 * after the text. `data:` URIs are stripped by Gmail. The cost is that the
 * images load only from a deployed site, so a send from localhost shows the alt
 * text until the branch is live.
 *
 * It is laid out as one full-width row of three cells, so the whole message
 * reads in a laptop Gmail pane without scrolling: the 440px card in the middle
 * and two side cells with no width of their own. `table-layout:fixed` is what
 * makes that centre the card: a fixed table splits the width the card leaves
 * equally between the cells that name no width, where an auto table would split
 * it by their content and push the card off centre. Each side cell centres its content both
 * ways, so the logo sits in the middle of the left green and the follow block
 * in the middle of the right. The logo is sized to stay shorter than the card.
 * Plain table cells, so desktop Outlook lays it out without a ghost table. On a
 * phone one media query in the head turns the cells into blocks — logo, card,
 * follow — and shrinks the logo back; a client that strips <style> keeps the
 * row, and the logo can still shrink with its cell (`max-width:100%`). The
 * plain-text part stays for every client that shows no HTML at all.
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

/* Both are shown at half their size on disk, so they stay sharp on a dense
   screen (see `scripts/make-email-assets.ts`); the logo's height keeps the
   file's own aspect, 400×331 on disk. check-otp reads the files and fails if
   either drifts from these. */
const LOGO_W = 200;
const LOGO_H = 166;
const ICON = 28;

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
      `<td style="padding:0 5px;"><a href="${esc(s.href)}" target="_blank" style="text-decoration:none;">` +
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
<style>
@media only screen and (max-width:720px){
.kc-cell{display:block !important;width:100% !important;box-sizing:border-box;}
.kc-mid{padding:0 12px !important;}
.kc-card{width:100% !important;}
.kc-logo{width:96px !important;margin:0 auto;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your code is ${c}. It expires in ${span}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};table-layout:fixed;">
<tr>
<td class="kc-cell kc-side" align="center" valign="middle" style="padding:16px 12px;">
<a href="${esc(origin)}" target="_blank" style="text-decoration:none;"><img class="kc-logo" src="${esc(`${origin}/email-assets/kranti-logo.png`)}" width="${LOGO_W}" height="${LOGO_H}" alt="Kranti Cookbook" style="display:block;border:0;width:${LOGO_W}px;max-width:100%;height:auto;color:${CREAM};font:bold 20px ${SERIF};"></a>
</td>
<td class="kc-cell kc-mid" width="440" valign="middle" style="width:440px;padding:16px 0;">
<table role="presentation" class="kc-card" width="440" cellpadding="0" cellspacing="0" border="0" style="width:440px;"><tr><td bgcolor="${CARD}" align="center" style="background:${CARD};border-radius:8px;padding:20px 22px;text-align:center;font-family:${SANS};color:${INK};">
<h1 style="margin:0 0 6px;font:bold 18px/1.3 ${SERIF};color:${INK};">Verify your email</h1>
<p style="margin:0 0 12px;font-size:14px;line-height:1.45;color:${INK};">Enter this code to finish submitting your recipe.</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;">
<tr><td align="center" style="border:2px solid ${CREAM};border-radius:8px;padding:8px 16px 8px 22px;font:bold 24px/1 ${MONO};letter-spacing:6px;color:${INK};">${c}</td></tr>
</table>
<p style="margin:0 0 2px;font-size:13px;line-height:1.45;color:${INK};">${expiry}</p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:${INK};">Never share it. Kranti Cookbook will never ask you for it.</p>
<p style="margin:0;font-size:12px;line-height:1.45;color:${MUTED};">Didn&#39;t ask for this? Ignore this email; nothing happens without the code.</p>
</td></tr></table>
</td>
<td class="kc-cell kc-side" align="center" valign="middle" style="padding:16px 12px;font-family:${SANS};color:${CREAM};">
<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;color:${CREAM};">Follow Kranti Cookbook</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>${icons}</tr></table>
<p style="margin:10px 0 0;font-size:12px;"><a href="${esc(origin)}" target="_blank" style="color:${CREAM};text-decoration:none;">${esc(host)}</a></p>
</td>
</tr>
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
