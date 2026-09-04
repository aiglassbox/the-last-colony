// src/app/add-recipe/AddRecipeForm.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { BELONGS_TO, PHOTO_MAX_BYTES, STATES, type Extracted, type Photo } from "@/lib/community/schema";

/**
 * The submission form, two ways in. The server's validateSubmission is the
 * boundary; everything here is convenience mirroring it, so a field the API
 * would refuse is refused before the round trip.
 *
 * "From a photo" reads the card first and prefills; the submitter corrects
 * before anything is stored as their words. The envelope the server gets
 * says what happened, not which button was pressed: a reading that landed
 * makes it image mode, a failed reading followed by typing is manual mode
 * with a photo attached.
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

type Mode = "manual" | "image";

const READ_FAILED: Record<string, string> = {
  not_recipe: "We couldn't find a recipe or a dish in that photo. Try another, or type it in.",
  unreadable: "The writing is too blurred or dark to read. Try a clearer photo, or type it in.",
};

export function AddRecipeForm() {
  const [mode, setMode] = useState<Mode>("manual");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [belongsTo, setBelongsTo] = useState("grandmother");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  /** What the reading returned. The recipe fieldset remounts with it as defaults. */
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [extractKey, setExtractKey] = useState(0);

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
        setExtracted(payload.extracted as Extracted);
        setExtractKey((k) => k + 1);
        setPhotoNote("Read from your photo — check every field below before submitting. Empty ones need your words.");
      } else if (res.status === 422) {
        setPhotoNote(READ_FAILED[String(payload?.error)] ?? "We couldn't read that photo. Try another, or type it in.");
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
      if (mode === "image") await readPhoto(compressed);
      else setPhotoNote(`Attached (${Math.round(compressed.bytes / 1024)}KB).`);
    } finally {
      setReading(false);
    }
  }

  function switchMode(next: Mode) {
    // The buttons carry disabled={reading}: a read in flight captured this
    // mode in its closure, and letting it land after a switch would re-attach
    // the photo and remount the fieldset over whatever was typed since.
    setMode(next);
    // The file input moves (top in photo mode, bottom in manual) and so
    // remounts empty. If no reading landed, drop the photo state with it so
    // the form holds what the screen shows; a reading that did land stays —
    // clearing it would drop the audit trail while the fields keep its text.
    if (!extracted) {
      setPhoto(null);
      setPhotoNote("");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || reading) return;
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
      contact: field("contact"),
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
      else setErrors(["Submissions are unavailable right now. Your recipe was not lost — please try later."]);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="recipe-form">
        <Link href="/" className="recipe-form__back">← Back to chat</Link>
        <h1 className="recipe-form__title">Submitted for review</h1>
        <p className="recipe-form__thanks">
          Thank you. Your recipe is in the review queue; if it is published it
          will carry your name and state exactly as you wrote them.
        </p>
      </main>
    );
  }

  const photoField = (
    <label className="recipe-form__field">
      {mode === "image"
        ? "Photo of the handwritten card or the dish. We read the recipe from it; you check every field before it is submitted."
        : "Photo (optional — the dish or the handwritten card; stored with your recipe, not read from)"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={reading}
        onChange={(e) => onPickPhoto(e.target.files?.[0])}
      />
      {photoNote && <span className="recipe-form__note">{photoNote}</span>}
    </label>
  );

  return (
    <main className="recipe-form">
      {/* The rail lives on the chat page only, so this page carries its own
          way back. */}
      <Link href="/" className="recipe-form__back">← Back to chat</Link>
      <h1 className="recipe-form__title">Add Your Recipe</h1>
      <p className="recipe-form__lede">
        A family recipe, in your words. What you write is shown as you wrote it.
      </p>

      <div className="recipe-form__modes" role="group" aria-label="How would you like to add it?">
        <button type="button" className="recipe-form__mode" aria-pressed={mode === "manual"} onClick={() => switchMode("manual")} disabled={reading}>
          Type it in
        </button>
        <button type="button" className="recipe-form__mode" aria-pressed={mode === "image"} onClick={() => switchMode("image")} disabled={reading}>
          From a photo
        </button>
      </div>

      {errors.length > 0 && (
        <ul className="recipe-form__errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit}>
        {mode === "image" && photoField}

        <label className="recipe-form__field">
          Your name (real or family nickname)
          <input name="display_name" required maxLength={80} />
        </label>

        <label className="recipe-form__field">
          State
          <select name="state" required defaultValue="">
            <option value="" disabled>Choose a state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label className="recipe-form__field">
          City or town (optional)
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
            Who? (Nani, Dadi, Badi Amma — your word for them)
            <input name="belongs_to_other" required maxLength={80} />
          </label>
        )}

        {/* Remounted with the reading as defaults when one lands; untouched otherwise. */}
        <fieldset key={extractKey} className="recipe-form__fieldset">
          <label className="recipe-form__field">
            Recipe name (any language, any script)
            <input name="recipe_name" required maxLength={120} defaultValue={extracted?.recipe_name ?? ""} />
          </label>

          <label className="recipe-form__field">
            The story — when it is made, why it matters
            <textarea name="story" required maxLength={4000} rows={4} defaultValue={extracted?.story ?? ""} />
          </label>

          <label className="recipe-form__field">
            Ingredients
            <textarea name="ingredients" required maxLength={4000} rows={4} defaultValue={extracted?.ingredients ?? ""} />
          </label>

          <label className="recipe-form__field">
            Method
            <textarea name="method" required maxLength={8000} rows={6} defaultValue={extracted?.method ?? ""} />
          </label>
        </fieldset>

        {mode === "manual" && photoField}

        <label className="recipe-form__field">
          Contact (email or phone — never shown publicly, used only to reach you about this recipe)
          <input name="contact" required maxLength={120} />
        </label>

        <label className="recipe-form__consent">
          <input type="checkbox" name="right_to_share" required />
          I have the right to share this recipe.
        </label>
        <label className="recipe-form__consent">
          <input type="checkbox" name="public_display" required />
          My name, location and recipe may be shown publicly and used by the AI.
        </label>

        <button type="submit" className="recipe-form__submit" disabled={busy || reading}>
          {busy ? "Submitting…" : "Submit recipe"}
        </button>
      </form>
    </main>
  );
}
