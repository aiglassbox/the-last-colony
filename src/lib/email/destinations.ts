/**
 * Where each email link code actually sends people.
 *
 * The launch email is a single hosted image with three clickable regions, so
 * there are three codes and no more. Adding one here makes it trackable and
 * nothing else has to change.
 *
 * This map is the whole security model for `/r`. The destination is only ever
 * looked up here by a short code; a URL arriving in the query string is never
 * redirected to, because that is an open redirect and it is how a sending
 * domain ends up on a blocklist.
 */

/**
 * The origin used for destinations that live on this site.
 *
 * Read from the environment rather than from the request's `Host` header on
 * purpose. Building a redirect out of a header a client controls is the same
 * open-redirect hole by a quieter route, and the value is known at deploy time
 * anyway. Set `SITE_URL=http://localhost:3000` to exercise `/r` locally.
 */
function site(path: string): string {
  const origin = (process.env.SITE_URL ?? "https://kranticookbook.com").replace(/\/+$/, "");
  return `${origin}${path}`;
}

export const DESTINATIONS: Record<string, string> = {
  /**
   * DISCOVER THE KRANTI COOKBOOK AI.
   *
   * Tagged, because the site already parses UTM markers on landing and carries
   * them on every later event — see `src/lib/attribution.ts`. That makes a
   * click from this email attributable all the way through to a restoration,
   * not just to the redirect. The off-site destinations below are left clean:
   * we have already recorded the click ourselves, and appending our markers to
   * someone else's URL buys nothing.
   */
  ai: site(
    "/?utm_source=email&utm_medium=email&utm_campaign=kranti-launch&utm_content=ai",
  ),

  /** WATCH THE FILM. */
  film: "https://www.youtube.com/watch?v=C928wUxnVpo",

  /** READ THE POST. */
  post: "https://www.instagram.com/kranticookbook/",
};

/**
 * Where an unknown or missing code goes.
 *
 * Never a 404 and never an error page. A code we do not recognise means the
 * mail merge wrote something we did not expect, and the reader is not the one
 * who should find that out.
 */
export function destinationFor(code: string | null): string {
  return (code && DESTINATIONS[code]) || site("/");
}
