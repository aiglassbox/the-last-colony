// src/app/add-recipe/AddRecipeForm.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { BELONGS_TO, PHOTO_MAX_BYTES, STATES } from "@/lib/community/schema";
import { LANG_NAMES, SUPPORTED_LANGS } from "@/lib/lang/types";

/**
 * Manual submission form. The server's validateSubmission is the boundary;
 * everything here is convenience mirroring it, so a field the API would
 * refuse is refused before the round trip.
 */

/** Downscale + JPEG-encode so the payload fits the server's photo cap. */
async function compressImage(file: File): Promise<{ data: string; mime: string; bytes: number } | null> {
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

export function AddRecipeForm() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [belongsTo, setBelongsTo] = useState("grandmother");
  const [photo, setPhoto] = useState<{ data: string; mime: string; bytes: number } | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  async function onPickPhoto(file: File | undefined) {
    setPhotoNote("");
    setPhoto(null);
    if (!file) return;
    const compressed = await compressImage(file);
    if (!compressed) {
      setPhotoNote("That image could not be read or compressed under 500KB — try another.");
      return;
    }
    setPhoto(compressed);
    setPhotoNote(`Attached (${Math.round(compressed.bytes / 1024)}KB).`);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setErrors([]);
    const form = new FormData(e.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();

    const body = {
      display_name: field("display_name"),
      state: field("state"),
      city: field("city") || undefined,
      belongs_to: field("belongs_to"),
      belongs_to_other: field("belongs_to_other") || undefined,
      recipe_name: field("recipe_name"),
      story: field("story"),
      ingredients: field("ingredients"),
      method: field("method"),
      language: field("language"),
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

  return (
    <main className="recipe-form">
      {/* The rail lives on the chat page only, so this page carries its own
          way back. */}
      <Link href="/" className="recipe-form__back">← Back to chat</Link>
      <h1 className="recipe-form__title">Add Your Recipe</h1>
      <p className="recipe-form__lede">
        A family recipe, in your words. What you write is shown as you wrote it.
      </p>

      {errors.length > 0 && (
        <ul className="recipe-form__errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit}>
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

        <label className="recipe-form__field">
          Recipe name (any language, any script)
          <input name="recipe_name" required maxLength={120} />
        </label>

        <label className="recipe-form__field">
          The story — when it is made, why it matters
          <textarea name="story" required maxLength={4000} rows={4} />
        </label>

        <label className="recipe-form__field">
          Ingredients
          <textarea name="ingredients" required maxLength={4000} rows={4} />
        </label>

        <label className="recipe-form__field">
          Method
          <textarea name="method" required maxLength={8000} rows={6} />
        </label>

        <label className="recipe-form__field">
          Photo (optional — the dish or the handwritten card; stored with your recipe, not read from)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => onPickPhoto(e.target.files?.[0])}
          />
          {photoNote && <span className="recipe-form__note">{photoNote}</span>}
        </label>

        <label className="recipe-form__field">
          Language you are writing in
          <select name="language" required defaultValue="en">
            {SUPPORTED_LANGS.map((code) => (
              <option key={code} value={code}>{LANG_NAMES[code]}</option>
            ))}
          </select>
        </label>

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

        <button type="submit" className="recipe-form__submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit recipe"}
        </button>
      </form>
    </main>
  );
}
