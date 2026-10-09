/**
 * Generates the emails' images into `public/email-assets/`: the Kranti logo and
 * the Instagram/YouTube/X icons as PNG, and the folk-art crops (`art-*`) the
 * recipe emails in `email-templates/` use.
 *
 * Every image is linked by absolute URL, from the code email
 * (`src/lib/community/otp-email.ts`) and from the recipe emails in
 * `email-templates/` (via `{{site_url}}`).
 * Gmail fetches remote images through its image proxy and caches them, so after
 * the first open they show almost at once; inline (CID) attachments were fetched
 * afresh for every email, a second or two after the text. The cost is that they
 * load only from a deployed site.
 *
 * The logo and icons are PNG because mail clients do not render SVG. The logo
 * is tinted onto a solid cream plate because the site uses `brand/kranti.png`
 * as a mask, so the file itself carries no colour of its own, only an alpha.
 * `art-hero.jpg` keeps its painted green and is not keyed; the bird is cut
 * from `public/email-assets/slice-01.jpg`.
 *
 *   npx tsx scripts/make-email-assets.ts
 *
 * One-off: run it again only if the logo, a social SVG or the art changes. It
 * rewrites every file, `art-*` included, under the same name, and the proxy and
 * the week-long cache `next.config.ts` sets on `/email-assets/` will keep
 * serving the old image, so give a changed file a new name and update its links
 * in otp-email.ts and `email-templates/`. A `?v=` busts the cache too, but only
 * in otp-email.ts: check-email-templates looks each template image up by its
 * file name, so a `?v=` there fails the check. It is not part of `npm run check`.
 */
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const out = (file: string) => path.join(root, "public", "email-assets", file);

/* Twice the size `otp-email.ts` shows them at (200 px logo, 28 px icons), so
   they stay sharp on a dense screen; check-otp fails if the two drift apart. */
const LOGO_PX = 400;
const ICON_PX = 56;

type Region = { left: number; top: number; width: number; height: number };

/**
 * Lifts a crop of the folk art off its painted green ground, onto
 * transparency. The ground is the only paint markedly greener than it is red
 * or blue; the art's creams, ochres and reds are not, and its outlines are
 * near grey, so a soft threshold on "how much greener" keeps every line and
 * drops the field. Laid on the emails' flat greens or creams, the art then has
 * no textured rectangle around it.
 */
async function keyed(file: string, region: Region, width: number): Promise<ReturnType<typeof sharp>> {
  const { data, info } = await sharp(file)
    .extract(region)
    .resize({ width })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const greener = Math.min(g - r, g - b * 0.6);
    rgba[j] = r;
    rgba[j + 1] = g;
    rgba[j + 2] = b;
    rgba[j + 3] = Math.max(0, Math.min(255, 255 - (greener - 4) * 14));
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } });
}

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

  // The recipe emails' art. Each is at least twice the size the templates show
  // it at, and under 100KB; check-email-templates fails otherwise.
  const phad = path.join(root, "public", "brand", "phad-wide.jpg");
  const launch = path.join(root, "public", "email-assets", "slice-01.jpg");
  const png = { compressionLevel: 9, palette: true } as const;

  await (await keyed(launch, { left: 118, top: 186, width: 104, height: 86 }, 104)).png(png).toFile(out("art-bird.png"));
  await (await keyed(phad, { left: 0, top: 640, width: 1920, height: 440 }, 1200))
    .flatten({ background: "#fbf3e2" })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(out("art-cooks-cream.jpg"));
  await (await keyed(phad, { left: 0, top: 120, width: 540, height: 580 }, 270)).png(png).toFile(out("art-tree-left.png"));
  // The right tree is the left one mirrored: the painting's own right tree has a
  // seated cook under its crown, and a mirrored pair frames a poster evenly.
  await (await keyed(phad, { left: 0, top: 120, width: 540, height: 580 }, 270)).flop().png(png).toFile(out("art-tree-right.png"));
  await sharp(phad).resize({ width: 1200 }).jpeg({ quality: 64, mozjpeg: true }).toFile(out("art-hero.jpg"));
  console.log("art-bird.png, art-cooks-cream.jpg, art-tree-left.png, art-tree-right.png, art-hero.jpg");
}

main().then(() => process.exit(0));
