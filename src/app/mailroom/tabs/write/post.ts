/**
 * One call to the mailroom's endpoint, with every failure turned into a
 * sentence the operator can act on.
 *
 * A 404 is the lapsed cookie: the route answers 404 to anything without
 * access, the same answer an unset password gets, so there is nothing more
 * specific to say than "log in again".
 */

export type Posted<T> = { ok: true; data: T } | { ok: false; error: string };

export const SESSION_ENDED = "Your session has ended. Reload the page to log in again.";

/** The route's messages start lower-case ("choose the submission…"); on the page they open a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export async function postMail<T>(body: Record<string, unknown>): Promise<Posted<T>> {
  try {
    const response = await fetch("/mailroom/api/mail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 404) return { ok: false, error: SESSION_ENDED };

    const json: unknown = await response.json().catch(() => null);
    if (response.ok && json !== null) return { ok: true, data: json as T };

    const message = (json as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof message === "string" ? sentence(message) : `The server answered ${response.status}.` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
