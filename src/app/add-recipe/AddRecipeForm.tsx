// src/app/add-recipe/AddRecipeForm.tsx
"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { BELONGS_TO, PHOTO_MAX_BYTES, STATES, type Extracted, type Photo } from "@/lib/community/schema";

import { EmailVerify, type Verified } from "./EmailVerify";

/**
 * One form, shown as the comp's two screens: who you are and the photo, then
 * the recipe itself. The server's validateSubmission is the boundary;
 * everything here is convenience mirroring it, so a field the API would refuse
 * is refused before the round trip.
 *
 * Both screens stay mounted — the second is `hidden`, not unmounted — because
 * the fields are uncontrolled and read with FormData at submit. Unmounting
 * screen one to show screen two would drop every word typed into it. Screen
 * one is validated on its own controls before Next advances, so screen two is
 * never reachable with a hidden required field left empty, which would
 * otherwise bar the form from submitting with nothing on screen to fix.
 *
 * A photo is offered first and is optional. Attach one and we read it and
 * prefill; attach nothing and the same fields are typed by hand. The envelope
 * the server gets says what actually happened, not what was offered: a
 * reading that landed makes it image mode, everything else — no photo, or a
 * photo we could not read — is manual mode.
 *
 * A reading never overwrites words already typed. It fills the fields the
 * submitter left blank and leaves the rest alone, while `extracted` keeps the
 * model's reading verbatim for the pantry to show beside what was confirmed.
 *
 * The email is verified inline, by EmailVerify, and Submit stays locked until
 * it is. The submit carries the verified email and its proof, never the
 * field's text, so what was verified is what is stored.
 */

/** Downscale + JPEG-encode so the payload fits the server's photo cap. */
async function compressImage(file: File): Promise<Photo | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    const data = url.split(",")[1];
    const bytes = Math.ceil((data.length * 3) / 4);
    if (bytes <= PHOTO_MAX_BYTES) return { data, mime: "image/jpeg", bytes };
  }
  return null;
}

const READ_FAILED: Record<string, string> = {
  not_recipe: "We couldn't find a recipe or a dish in that photo. Try another, or just fill the fields in below.",
  unreadable: "The writing is too blurred or dark to read. Try a clearer photo, or just fill the fields in below.",
};

export function AddRecipeForm() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [belongsTo, setBelongsTo] = useState("grandmother");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  /** The reading, verbatim, as sent to the server. Never merged with typing. */
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  /** What the fieldset remounts with: the reading, minus anything already typed. */
  const [defaults, setDefaults] = useState<Extracted | null>(null);
  const [extractKey, setExtractKey] = useState(0);
  /** The email that proved itself and the proof the submit must carry. */
  const [verified, setVerified] = useState<Verified | null>(null);
  /** Bumped to remount EmailVerify from scratch when the submit says the verification lapsed. */
  const [verifyKey, setVerifyKey] = useState(0);
  /** Which of the comp's two screens is showing. Both stay in the DOM. */
  const [step, setStep] = useState<1 | 2>(1);
  const formRef = useRef<HTMLFormElement>(null);
  const stepOneRef = useRef<HTMLDivElement>(null);

  async function readPhoto(p: Photo) {
    setPhotoNote("Reading your photo…");
    try {
      const res = await fetch("/api/submissions/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photo: { data: p.data, mime: p.mime } }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.extracted) {
        const read = payload.extracted as Extracted;
        setExtracted(read);
        // The fieldset is uncontrolled and remounts on extractKey, so a naive
        // prefill would wipe a story someone typed before reaching up to
        // attach the photo. Take the reading only where they left a blank.
        const typed = new FormData(formRef.current ?? undefined);
        const keep = (name: keyof Extracted) => String(typed.get(name) ?? "").trim() || read[name];
        setDefaults({
          recipe_name: keep("recipe_name"),
          story: keep("story"),
          ingredients: keep("ingredients"),
          method: keep("method"),
        });
        setExtractKey((k) => k + 1);
        setPhotoNote("Read from your photo — check every field before submitting. Empty ones need your words.");
      } else if (res.status === 422) {
        setPhotoNote(
          READ_FAILED[String(payload?.error)] ??
            "We couldn't read that photo. Try another, or just fill the fields in below.",
        );
      } else if (res.status === 429) {
        setPhotoNote(`Too many tries — wait ${payload?.retryAfter ?? 60}s, or type it in.`);
      } else {
        setPhotoNote("Reading photos is unavailable right now — you can still type it in.");
      }
    } catch {
      // fetch itself failed (offline, DNS): same copy as a 5xx, never a stuck "Reading…".
      setPhotoNote("Reading photos is unavailable right now — you can still type it in.");
    }
  }

  async function onPickPhoto(file: File | undefined) {
    setPhotoNote("");
    setPhoto(null);
    // A reading belongs to the photo it came from; a new photo starts clean.
    // `defaults` is left alone — it is already merged into the mounted fields,
    // and clearing it would drop the previous reading out from under them.
    setExtracted(null);
    if (!file) return;
    // The input stays disabled from the first byte of compression to the end
    // of the read, so a second pick cannot overlap the first and leave a
    // reading beside a photo it did not come from.
    setReading(true);
    try {
      const compressed = await compressImage(file);
      if (!compressed) {
        setPhotoNote("That image could not be read or compressed under 500KB — try another.");
        return;
      }
      setPhoto(compressed);
      await readPhoto(compressed);
    } finally {
      setReading(false);
    }
  }

  /**
   * Screen one's own controls, checked before it hands over. `reportValidity`
   * shows the browser's native bubble on the first offender, which is only
   * possible while the screen is still on show — hence the check here rather
   * than at submit, where these fields are hidden and a bubble would have
   * nowhere to point.
   */
  function toStepTwo() {
    const controls = stepOneRef.current?.querySelectorAll<HTMLInputElement>("input, select, textarea");
    for (const control of controls ?? []) {
      if (!control.reportValidity()) return;
    }
    setErrors([]);
    setStep(2);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || reading || !verified) return;
    setErrors([]);
    const form = new FormData(e.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();

    const body = {
      mode: extracted ? "image" : "manual",
      ...(extracted && { extracted }),
      display_name: field("display_name"),
      state: field("state"),
      city: field("city") || undefined,
      belongs_to: field("belongs_to"),
      belongs_to_other: field("belongs_to_other") || undefined,
      recipe_name: field("recipe_name"),
      story: field("story"),
      ingredients: field("ingredients"),
      method: field("method"),
      consent: {
        right_to_share: form.get("right_to_share") === "on",
        public_display: form.get("public_display") === "on",
      },
      contact: verified.email,
      proof: verified.proof,
      photo: photo ?? undefined,
    };

    setBusy(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        setSent(true);
        return;
      }
      const payload = await res.json().catch(() => null);
      if (res.status === 400 && Array.isArray(payload?.errors)) setErrors(payload.errors);
      else if (res.status === 429) setErrors([`Too many submissions — try again in ${payload?.retryAfter ?? 60}s.`]);
      else if (res.status === 403) {
        setErrors(["Your verification lapsed — verify your email again."]);
        setVerified(null);
        setVerifyKey((k) => k + 1);
      } else if (res.status === 413) {
        // The payload the server refused is the photo; nothing else here comes
        // close to the cap. Say so, rather than blaming an outage.
        setErrors(["That photo is too large to submit — attach a smaller one, or submit without it."]);
      }
      // A 503 keeps the verification if the server managed to release it, and
      // silently spends it if that release failed too. Either way the retry
      // is the same button, and a spent one comes back as the 403 above.
      else setErrors(["Submissions are unavailable right now. Your recipe was not lost — please try later. You may need to verify your email again."]);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="recipe-form">
        <div className="recipe-form__head">
          <p className="recipe-form__lede">Submitted for review.</p>
          <Link href="/" className="recipe-form__back">← Back to chat</Link>
        </div>
        <div className="recipe-form__box">
          <h1 className="recipe-form__title">Submitted for review</h1>
          <p className="recipe-form__thanks">
            Thank you. Your recipe is in the review queue; if it is published it
            will carry your name and state exactly as you wrote them.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="recipe-form">
      {/* The comp opens on the lede, not a title — but a page with no heading
          has no outline to land on, so the heading is here for the reader who
          arrives by one. */}
      <h1 className="sr-only">Add Your Recipe</h1>

      <div className="recipe-form__head">
        <p className="recipe-form__lede">
          A family recipe, in your words. What you write is shown as you wrote it.
          <br />
          Start from a photo of the handwritten card if you have one — or fill it
          in yourself.
        </p>
        {/* The rail lives on the chat page only, so this page carries its own
            way back. */}
        <Link href="/" className="recipe-form__back">← Back to chat</Link>
      </div>

      {errors.length > 0 && (
        <ul className="recipe-form__errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={onSubmit}>
        <div className="recipe-form__box" ref={stepOneRef} hidden={step !== 1}>
          <p className="recipe-form__intro">
            <strong>Upload Photo</strong> of the handwritten card or the dish —
            optional. We read the recipe from it and fill in what you have left
            blank; you check every field before it is submitted.
          </p>

          {/* The native control's own button and filename cannot be styled into
              the comp's full-width plate, so the label is the plate and the
              input is only visually hidden — still focusable, still activated
              by the label, and the focus ring is drawn on the plate around it. */}
          <label className="recipe-form__file">
            Select your photo
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              disabled={reading}
              onChange={(e) => onPickPhoto(e.target.files?.[0])}
            />
          </label>
          {photoNote && <p className="recipe-form__note">{photoNote}</p>}

          <label className="recipe-form__field">
            Full Name <em>(real or family nickname)</em>
            <input name="display_name" required maxLength={80} />
          </label>

          <label className="recipe-form__field">
            State
            <select name="state" required defaultValue="">
              <option value="" disabled>Select your state</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label className="recipe-form__field">
            City <em>(Optional)</em>
            <input name="city" maxLength={80} />
          </label>

          <label className="recipe-form__field">
            This recipe belongs to
            <select name="belongs_to" value={belongsTo} onChange={(e) => setBelongsTo(e.target.value)}>
              {BELONGS_TO.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </label>

          {belongsTo === "other" && (
            <label className="recipe-form__field">
              Who? <em>(Nani, Dadi, Badi Amma — your word for them)</em>
              <input name="belongs_to_other" required maxLength={80} />
            </label>
          )}
        </div>

        <div className="recipe-form__box" hidden={step !== 2}>
          {/* Remounted when a reading lands, with typed words preserved; untouched otherwise.
              Namespaced, because the counter beside it starts at 0 too and these
              two are siblings — bare counters made both children key `0`. */}
          <fieldset key={`extract-${extractKey}`} className="recipe-form__fieldset">
            <label className="recipe-form__field">
              Recipe name <em>(any language, any script)</em>
              <input name="recipe_name" required maxLength={120} defaultValue={defaults?.recipe_name ?? ""} />
            </label>

            <label className="recipe-form__field">
              The story <em>— when it is made, why it matters</em>
              <textarea name="story" required maxLength={4000} rows={4} defaultValue={defaults?.story ?? ""} />
            </label>

            <label className="recipe-form__field">
              Ingredients
              <textarea name="ingredients" required maxLength={4000} rows={4} defaultValue={defaults?.ingredients ?? ""} />
            </label>

            <label className="recipe-form__field">
              Method
              <textarea name="method" required maxLength={8000} rows={6} defaultValue={defaults?.method ?? ""} />
            </label>
          </fieldset>

          <EmailVerify key={`verify-${verifyKey}`} onChange={setVerified} />

          <label className="recipe-form__consent">
            <input type="checkbox" name="right_to_share" required />
            I have the right to share this recipe.
          </label>
          <label className="recipe-form__consent">
            <input type="checkbox" name="public_display" required />
            My name, location and recipe may be shown publicly and used by the AI.
          </label>
        </div>

        <div className="recipe-form__actions">
          {step === 1 ? (
            <button type="button" className="recipe-form__submit" onClick={toStepTwo}>
              Next
            </button>
          ) : (
            <>
              <button type="button" className="recipe-form__button" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="submit" className="recipe-form__submit" disabled={busy || reading || !verified}>
                {busy ? "Submitting…" : "Submit"}
              </button>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
