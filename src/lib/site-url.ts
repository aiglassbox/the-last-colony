/**
 * The origin this site is served from.
 *
 * Every absolute URL the app emits — the OG image on a share, the entries in
 * the sitemap, the sitemap line in robots.txt — has to be the real origin or it
 * is worse than absent. A share card pointing at a host the crawler cannot
 * reach renders as a broken preview, and a sitemap of unreachable URLs is a
 * pile of errors in Search Console.
 *
 * `SITE_URL` is still read first, so a preview deploy or a staging host can
 * name itself. What changed is the fallback: it used to be localhost, and an
 * unset variable in production therefore published `http://localhost:3000` into
 * live metadata rather than failing loudly. The production origin is the safer
 * default, because being wrong about a preview host costs a wrong link in a
 * preview, while being wrong about production costs every share.
 */
const PRODUCTION_ORIGIN = "https://kranticookbook.com";

export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim();
  const origin = raw && /^https?:\/\//.test(raw) ? raw : PRODUCTION_ORIGIN;
  // Trailing slashes double up once a path is appended.
  return origin.replace(/\/+$/, "");
}
