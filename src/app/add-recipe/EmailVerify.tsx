// src/app/add-recipe/EmailVerify.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { normalizeEmail } from "@/lib/community/schema";

/**
 * The email step of the form: send a code, enter it, hold the proof.
 *
 * Every rule is enforced at the routes; the clocks and the disabled buttons
 * here are convenience that mirrors them, so a person sees "Resend in 2:59"
 * rather than a 429. When the server disagrees (a 429 with a `retryAfter`),
 * the clock is reset from the server's number — in every phase, because idle
 * is reachable while a cooldown is still running (a "Change email", the 403
 * remount, a page reload).
 *
 * The parent gets `{ email, proof }` on verify and `null` whenever that stops
 * being true — a new send, a changed email, or the hold running out — and
 * remounts this component (by `key`) when the submit answers 403.
 */

export interface Verified {
  email: string;
  proof: string;
}

type Phase = "idle" | "sent" | "verified";

const UNAVAILABLE = "Email verification is unavailable right now — please try later.";

/** The code's life and the verification hold, in the server's own units. Both are
 *  the fallback when a response does not carry the number, and both are the copy. */
const CODE_SECONDS = 300;
const HOLD_MINUTES = 15;

function mmss(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "5 minutes", "1 minute" — a sentence says a length, never a ticking number. */
function minutes(n: number): string {
  return `${n} minute${n === 1 ? "" : "s"}`;
}

/**
 * A duration out of a response, or the default. Our routes always send a number,
 * but anything else — a string, a null, a missing field — would otherwise reach a
 * clock as `NaN`, which is neither running nor lapsed: the ticker would never
 * stop and the label would read `NaN:NaN`.
 */
function duration(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function EmailVerify({ onChange }: { onChange: (verified: Verified | null) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  /** Which request is in flight, so the label lands on the button that is working. */
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [locked, setLocked] = useState(false);
  /** Sends in this `sent` phase, so a resend is a different sentence to announce. */
  const [sends, setSends] = useState(0);
  /** The lengths the server granted, for the sentences that state them in words. */
  const [codeLife, setCodeLife] = useState(CODE_SECONDS);
  const [holdMinutes, setHoldMinutes] = useState(HOLD_MINUTES);
  /** ms epochs; null when the clock is not running. */
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  // The two server rate limits are independent — a 429 from one says nothing
  // about the other — so each gets its own epoch. They outlive a phase change:
  // "Change email" does not persuade the server to forget a cooldown.
  const [sendBlockUntil, setSendBlockUntil] = useState<number | null>(null);
  const [verifyBlockUntil, setVerifyBlockUntil] = useState<number | null>(null);
  /** Ticks once a second while any clock runs. Stale once they all stop — nothing rendered reads a clock then. */
  const [now, setNow] = useState(0);

  // The interval calls this rather than the prop, so `onChange` can leave the
  // dependency list. An inline arrow from a parent that re-renders faster than
  // once a second would otherwise recreate the interval before it ever fired,
  // freezing every clock and skipping the lapse.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const left = (at: number | null) => (at === null ? 0 : Math.ceil((at - now) / 1000));
  const expired = phase === "sent" && expiresAt !== null && left(expiresAt) <= 0;
  const sendBlocked = left(sendBlockUntil) > 0;
  const verifyBlocked = left(verifyBlockUntil) > 0;

  // One ticker, running while anything is counting down — a live code, the hold,
  // or either block. It also performs the lapse: the hold running out is a clock
  // event, so the reset belongs in the interval's callback rather than in an
  // effect body, which the React Compiler's set-state-in-effect rule refuses.
  //
  // An expired code counts down nothing, so `sent` alone does not hold the ticker
  // open: the tick that flips `expired` renders "Code expired." and then lets this
  // effect re-run and tear the ticker down.
  useEffect(() => {
    const counting =
      (phase === "sent" && !expired) ||
      (phase === "verified" && holdUntil !== null) ||
      sendBlockUntil !== null ||
      verifyBlockUntil !== null;
    if (!counting) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      // A block that has run out stops counting, which lets this effect re-run
      // and tear the ticker down once nothing else is running either.
      if (sendBlockUntil !== null && t >= sendBlockUntil) setSendBlockUntil(null);
      if (verifyBlockUntil !== null && t >= verifyBlockUntil) setVerifyBlockUntil(null);
      if (phase !== "verified" || holdUntil === null || t < holdUntil) return;
      // The hold ran out: back to the start, and the form locks again. This is
      // also what catches a verification that is gone for a reason we were
      // never told about — a 503 submit whose release of it failed too.
      setPhase("idle");
      setCode("");
      setLocked(false);
      setExpiresAt(null);
      setHoldUntil(null);
      setError("Your verification lapsed — verify your email again.");
      onChangeRef.current(null);
    }, 1000);
    return () => clearInterval(id);
  }, [phase, expired, holdUntil, sendBlockUntil, verifyBlockUntil]);

  const canSend = !busy && !sendBlocked;
  const canVerify = !busy && !locked && !expired && !verifyBlocked && code.length === 6;

  async function send() {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setError("That doesn't look like an email address.");
      return;
    }
    setBusy("send");
    setError("");
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      const payload = await res.json().catch(() => null);
      const t = Date.now();
      setNow(t);
      if (res.ok) {
        const life = duration(payload?.expiresIn, CODE_SECONDS);
        setEmail(normalized);
        setPhase("sent");
        setCode("");
        setLocked(false);
        // A resend inside the phase counts up; a first send from anywhere else
        // starts the count, so the sentence changes and is announced.
        setSends((n) => (phase === "sent" ? n + 1 : 1));
        setCodeLife(life);
        setExpiresAt(t + life * 1000);
        setSendBlockUntil(t + duration(payload?.resendIn, 180) * 1000);
        setHoldUntil(null);
        onChange(null);
      } else if (res.status === 429) {
        const wait = duration(payload?.retryAfter, 60);
        setError(`Too many codes — wait ${wait}s.`);
        // The server's clock outranks ours, whatever phase we think we are in.
        setSendBlockUntil(t + wait * 1000);
      } else if (res.status === 400) {
        setError("That doesn't look like an email address.");
      } else {
        setError(UNAVAILABLE);
      }
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setError("");
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const payload = await res.json().catch(() => null);
      const t = Date.now();
      setNow(t);
      if (res.ok && typeof payload?.proof === "string") {
        const hold = duration(payload.holdMinutes, HOLD_MINUTES);
        setPhase("verified");
        setHoldMinutes(hold);
        setHoldUntil(t + hold * 60_000);
        onChange({ email, proof: payload.proof });
      } else if (res.status === 400 && payload?.error === "wrong_code") {
        // A 400 has two shapes: this one, and `{ errors: [...] }` for a body
        // the route would not parse — which carries no `attemptsLeft` and
        // must not be rendered as "0 tries left".
        const n = Number(payload?.attemptsLeft ?? 0);
        setError(`Wrong code. ${n} ${n === 1 ? "try" : "tries"} left.`);
      } else if (res.status === 400) {
        setError("That code was not accepted — send a new one.");
      } else if (res.status === 410) {
        setLocked(true);
        setError(payload?.error === "locked" ? "Too many tries. Send a new code." : "Code expired. Send a new one.");
      } else if (res.status === 429) {
        const wait = duration(payload?.retryAfter, 60);
        setError(`Too many tries — wait ${wait}s.`);
        setVerifyBlockUntil(t + wait * 1000);
      } else {
        setError(UNAVAILABLE);
      }
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setBusy(null);
    }
  }

  function changeEmail() {
    setPhase("idle");
    setCode("");
    setError("");
    setLocked(false);
    setExpiresAt(null);
    setHoldUntil(null);
    // The block epochs are the server's, not this phase's: they stay.
    onChange(null);
  }

  // The status sentence carries no ticking number. It lives in the one
  // always-mounted live region below, so a screen reader hears it once instead
  // of queueing an announcement a second for five minutes and then fifteen.
  // A resend restarts both clocks, so the sentence has to differ from the one
  // already announced — an identical string is announced as nothing at all.
  const status =
    phase === "verified"
      ? `Verified. Submit your recipe within the next ${minutes(holdMinutes)}.`
      : phase === "sent"
        ? expired
          ? "Code expired. Send a new one."
          : `${sends > 1 ? "A new code was sent to" : "Code sent to"} ${email}. It expires in about ${minutes(Math.max(1, Math.round(codeLife / 60)))}.`
        : "";

  return (
    <div className="recipe-form__verify">
      <p className="recipe-form__lede">
        Fill in your recipe first, then verify your email. A verification lasts {minutes(HOLD_MINUTES)}.
      </p>

      <label className="recipe-form__field">
        Email (never shown publicly, used only to reach you about this recipe)
        <input
          type="email"
          autoComplete="email"
          maxLength={120}
          value={email}
          readOnly={phase !== "idle"}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            // Enter here would otherwise try to submit the recipe. It sends the
            // code instead, and only where the button would have.
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (phase === "idle" && canSend) void send();
          }}
        />
      </label>

      {phase === "idle" ? (
        <button type="button" className="recipe-form__button" disabled={!canSend} onClick={send}>
          {busy === "send" ? "Sending…" : sendBlocked ? `Send code in ${mmss(left(sendBlockUntil))}` : "Send code"}
        </button>
      ) : (
        <button type="button" className="recipe-form__link" onClick={changeEmail}>
          Change email
        </button>
      )}

      {/* Always mounted, so a phase change is a text mutation rather than a
          region insertion — but an empty one carries no class, or its top
          margin would show as a gap through the whole idle phase. */}
      <p className={status ? "recipe-form__note" : undefined} aria-live="polite">
        {status}
      </p>

      {phase === "sent" && (
        <>
          {!expired && (
            <span className="recipe-form__note" aria-hidden="true">
              Expires in {mmss(left(expiresAt))}.
            </span>
          )}
          <label className="recipe-form__field">
            6-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={locked || expired}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (canVerify) void verify();
              }}
            />
          </label>
          <div className="recipe-form__row">
            <button type="button" className="recipe-form__button" disabled={!canVerify} onClick={verify}>
              {busy === "verify" ? "Checking…" : verifyBlocked ? `Verify in ${mmss(left(verifyBlockUntil))}` : "Verify"}
            </button>
            <button type="button" className="recipe-form__button" disabled={!canSend} onClick={send}>
              {busy === "send" ? "Sending…" : sendBlocked ? `Resend in ${mmss(left(sendBlockUntil))}` : "Resend"}
            </button>
          </div>
        </>
      )}

      {phase === "verified" && (
        <span className="recipe-form__note" aria-hidden="true">
          ✓ Submit within {mmss(left(holdUntil))}.
        </span>
      )}

      {error && (
        <p className="recipe-form__note recipe-form__note--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
