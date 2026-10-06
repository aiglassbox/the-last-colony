// src/app/add-recipe/track.ts
import { trackClient, type EventProps } from "@/lib/analytics";

/**
 * The form's half of the recipe-box funnel.
 *
 * One event name, `recipe_step`, told apart by props, so the event union, the
 * `/api/track` allowlist and the pixel map each grow by one line rather than
 * ten. The props are labels and a duration and nothing else: what the
 * submitter typed never leaves in a beacon.
 *
 * `outcomeOf` is the only place a response becomes a label. It follows the
 * same branches the form and the verify widget take on the same statuses, so
 * the dashboard and the sentence the reader saw agree. Pure, so
 * `scripts/check-recipe-box.ts` walks every status offline.
 */

export type RecipeStep =
  | "opened"
  | "photo_attached"
  | "photo_read"
  | "next"
  | "back"
  | "code_send"
  | "code_resend"
  | "change_email"
  | "verify"
  | "submit";

/** The steps that wait on a response, and so have an outcome. */
export type AnsweredStep = "photo_read" | "code_send" | "code_resend" | "verify" | "submit";

export interface StepResult {
  outcome: string;
  reason?: string;
}

/** A tab left open overnight is not a slow submitter; it would only stretch the chart. */
export const MAX_FINISH_MS = 24 * 60 * 60 * 1000;

// Maps rather than object literals: a payload's `error` is a string from the
// network, and `{}["constructor"]` is a function, not a miss.
const PHOTO_REFUSED = new Map<number, string>([
  [400, "invalid_photo"],
  [413, "too_large"],
  [429, "rate_limited"],
]);
const SEND_429 = new Map<string, string>([
  ["daily", "daily_cap"],
  ["cooldown", "cooldown"],
  ["cap", "cap"],
]);
const SUBMIT_REFUSED = new Map<number, string>([
  [400, "invalid"],
  [403, "lapsed"],
  [413, "too_large"],
  [429, "rate_limited"],
]);

const ok = (status: number) => status >= 200 && status < 300;

export function outcomeOf(step: AnsweredStep, status: number | "network", payload?: unknown): StepResult {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const said = typeof body.error === "string" ? body.error : "";

  switch (step) {
    case "photo_read":
      if (status === "network") return { outcome: "refused", reason: "network" };
      if (ok(status) && body.extracted) return { outcome: "ok" };
      if (status === 422) return { outcome: said === "not_recipe" ? "not_recipe" : "unreadable" };
      return { outcome: "refused", reason: PHOTO_REFUSED.get(status) ?? "unavailable" };

    case "code_send":
    case "code_resend":
      if (status === "network") return { outcome: "refused", reason: "network" };
      if (ok(status)) return { outcome: "ok" };
      if (status === 429) return { outcome: "refused", reason: SEND_429.get(said) ?? "rate_limited" };
      if (status === 400) return { outcome: "refused", reason: "bad_email" };
      return { outcome: "refused", reason: "unavailable" };

    case "verify":
      if (status === "network") return { outcome: "failed", reason: "network" };
      if (ok(status) && typeof body.proof === "string") return { outcome: "ok" };
      if (status === 400) return { outcome: "failed", reason: said === "wrong_code" ? "wrong_code" : "invalid" };
      if (status === 410) return { outcome: "failed", reason: said === "locked" ? "locked" : "expired" };
      if (status === 429) return { outcome: "failed", reason: "rate_limited" };
      return { outcome: "failed", reason: "unavailable" };

    case "submit":
      if (status === "network") return { outcome: "refused", reason: "network" };
      if (status === 201) return { outcome: "accepted" };
      return { outcome: "refused", reason: SUBMIT_REFUSED.get(status) ?? "unavailable" };
  }
}

/** The beacon's props. `ms` survives only on an accepted submit, clamped to a day. */
export function stepProps(step: RecipeStep, result?: StepResult, ms?: number): EventProps {
  const props: EventProps = { step };
  if (result) {
    props.outcome = result.outcome;
    if (result.reason) props.reason = result.reason;
  }
  if (step === "submit" && result?.outcome === "accepted" && ms !== undefined && Number.isFinite(ms)) {
    props.ms = Math.min(Math.max(0, Math.round(ms)), MAX_FINISH_MS);
  }
  return props;
}

/** Fire-and-forget, like every `trackClient` call: a lost beacon never touches the form. */
export function trackStep(step: RecipeStep, result?: StepResult, ms?: number): void {
  trackClient("recipe_step", stepProps(step, result, ms));
}
