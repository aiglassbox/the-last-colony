/**
 * Where a request came from, without ever knowing who it came from.
 *
 * The instinct is to store the IP and look it up later. This codebase
 * deliberately does not have one to store: the rate limiter reads an address
 * and keeps it in memory, and the email tracker hashes it with a salt
 * precisely so that `email_events` is not a table of people. Adding an
 * `ip_address` column to get a country out of it would undo a decision that
 * was made on purpose, and would turn two analytics logs into personal data
 * that then has to be retained, justified and deleted on request.
 *
 * It is also unnecessary. The edge resolves the address before the request
 * ever reaches this code and hands the answer over as headers, so what gets
 * stored is a country and a city — the derived fact, never the identifier it
 * was derived from. That is strictly less information than the alternative
 * and strictly more useful, because it needs no lookup table and no vendor.
 *
 * Read as raw headers rather than through `@vercel/functions`. Its
 * `geolocation()` is a wrapper over exactly these header names, and a
 * dependency for fifteen lines of header reading is not a trade this repo
 * makes anywhere else. `NextRequest.geo`, which used to carry this, was
 * removed in Next 15 — see `node_modules/next/dist/docs/.../version-15.md`.
 *
 * Every field is null off Vercel. A local run and a self-hosted deployment
 * both record events with no geography rather than failing, which is the same
 * posture the database handle and the model key already take.
 */

export interface Geo {
  /** ISO 3166-1 alpha-2, e.g. `IN`. */
  country: string | null;
  /** ISO 3166-2 subdivision, e.g. `MH`. Coarser than a city, finer than a country. */
  region: string | null;
  city: string | null;
  /** IANA zone, e.g. `Asia/Kolkata`. The one honest test of the IST assumption. */
  timezone: string | null;
}

export const NO_GEO: Geo = { country: null, region: null, city: null, timezone: null };

const MAX = 80;

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value ? value.slice(0, MAX) : null;
}

export function geoFrom(headers: Headers): Geo {
  return {
    country: header(headers, "x-vercel-ip-country"),
    region: header(headers, "x-vercel-ip-country-region"),
    /**
     * The city header is percent-encoded and nothing else is — Vercel sends
     * `New%20Delhi`, because a header value cannot carry a raw space. Decoding
     * it here rather than at the reader means the column holds a city name and
     * not an escape sequence, and it is wrapped because a malformed sequence
     * makes `decodeURIComponent` throw rather than return the input.
     */
    city: decodeCity(header(headers, "x-vercel-ip-city")),
    timezone: header(headers, "x-vercel-ip-timezone"),
  };
}

function decodeCity(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Geo as beacon props, for the routes that hand their payload to `track()`.
 *
 * Named with the same keys the columns use, because `recordEvent` lifts them
 * out by name — the same contract the campaign markers already travel under.
 * Nulls are dropped rather than sent, so an event off Vercel carries no
 * geography keys at all instead of four explicit nulls in its `props`.
 */
export function geoProps(headers: Headers): Record<string, string> {
  const geo = geoFrom(headers);
  return Object.fromEntries(
    Object.entries(geo).filter((entry): entry is [string, string] => entry[1] !== null),
  );
}
