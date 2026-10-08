/**
 * Generates the verification email's four images into `public/email-assets/`:
 * the Kranti logo and the Instagram/YouTube/X icons, as PNG.
 *
 * The email links them by absolute URL (see `src/lib/community/otp-email.ts`).
 * Gmail fetches remote images through its image proxy and caches them, so after
 * the first open they show almost at once; inline (CID) attachments were fetched
 * afresh for every email, a second or two after the text. The cost is that they
 * load only from a deployed site.
 *
 * They are PNG because mail clients do not render SVG. The logo is tinted onto
 * a solid cream plate because the site uses `brand/kranti.png` as a mask, so
 * the file itself carries no colour of its own, only an alpha.
 *
 *   npx tsx scripts/make-email-assets.ts
 *
 * One-off: run it again only if the logo or a social SVG changes, and then give
 * the changed file a new name (or a `?v=` in otp-email.ts): the proxy and the
 * week-long cache `next.config.ts` sets on `/email-assets/` will otherwise keep
 * serving the old one. It is not part of `npm run check`.
 */
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const out = (file: string) => path.join(root, "public", "email-assets", file);

/* Twice the size `otp-email.ts` shows them at (200 px logo, 28 px icons), so
   they stay sharp on a dense screen; check-otp fails if the two drift apart. */
const LOGO_PX = 400;
const ICON_PX = 56;

async function main() {
  const logo = sharp(path.join(root, "public", "brand", "kranti.png")).resize({ width: LOGO_PX });
  const alpha = await logo.clone().extractChannel("alpha").toBuffer();
  const { width = 0, height = 0 } = await sharp(alpha).metadata();
  await sharp({ create: { width, height, channels: 3, background: "#f8a81b" } })
    .joinChannel(alpha)
    .png({ compressionLevel: 9 })
    .toFile(out("kranti-logo.png"));
  console.log(`kranti-logo.png ${width}x${height}`);

  for (const n of ["instagram", "youtube", "x"]) {
    await sharp(path.join(root, "public", "brand", "social", `${n}.svg`), { density: 144 })
      .resize(ICON_PX, ICON_PX)
      .png({ compressionLevel: 9 })
      .toFile(out(`social-${n}.png`));
    console.log(`social-${n}.png ${ICON_PX}x${ICON_PX}`);
  }
}

main().then(() => process.exit(0));
