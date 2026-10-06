/**
 * Generates the images the verification email uses, into `public/email-assets/`:
 * `kranti-logo.png` and `social-{instagram,youtube,x}.png`.
 *
 * They are PNG because mail clients do not render SVG. The logo is tinted onto
 * a solid cream plate because the site uses `brand/kranti.png` as a mask, so
 * the file itself carries no colour of its own, only an alpha.
 *
 *   npx tsx scripts/make-email-assets.ts
 *
 * One-off: run it again only if the logo or a social SVG changes. It is not
 * part of `npm run check`.
 */
import path from "node:path";

import sharp from "sharp";

const root = path.join(process.cwd());
const out = path.join(root, "public", "email-assets");

async function main() {
  const logo = sharp(path.join(root, "public", "brand", "kranti.png")).resize({ width: 240 });
  const alpha = await logo.clone().extractChannel("alpha").toBuffer();
  const { width = 0, height = 0 } = await sharp(alpha).metadata();
  await sharp({ create: { width, height, channels: 3, background: "#f8a81b" } })
    .joinChannel(alpha)
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, "kranti-logo.png"));

  for (const n of ["instagram", "youtube", "x"]) {
    await sharp(path.join(root, "public", "brand", "social", `${n}.svg`), { density: 144 })
      .resize(72, 72)
      .png({ compressionLevel: 9 })
      .toFile(path.join(out, `social-${n}.png`));
  }
}

main().then(() => process.exit(0));
