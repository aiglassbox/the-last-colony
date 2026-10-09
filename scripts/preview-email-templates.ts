/**
 * Writes every recipe email, filled with the sample values, into a directory,
 * for screenshots:
 *
 *   npx tsx scripts/preview-email-templates.ts <outDir>
 *
 * Filled against http://localhost:3100, then the image links are pointed at
 * the files in `public/email-assets/`, so the previews open from disk with no
 * server running. A template that is not there yet is skipped, with a note.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fillTemplate } from "../src/lib/mail-templates/fill";
import { TEMPLATE_DIR, TEMPLATE_IDS } from "../src/lib/mail-templates/registry";
import { sampleValues } from "./email-template-samples";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: npx tsx scripts/preview-email-templates.ts <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const SITE = "http://localhost:3100";
const assets = pathToFileURL(join(process.cwd(), "public", "email-assets")).href;

for (const id of TEMPLATE_IDS) {
  const source = join(TEMPLATE_DIR, `${id}.html`);
  if (!existsSync(source)) {
    console.log(`skip ${id} (not written yet)`);
    continue;
  }
  const html = fillTemplate(readFileSync(source, "utf8"), sampleValues(id, SITE)).replaceAll(
    `${SITE}/email-assets`,
    assets,
  );
  const file = join(outDir, `${id.replace("/", "__")}.html`);
  writeFileSync(file, html);
  console.log(file);
}
