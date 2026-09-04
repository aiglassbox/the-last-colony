"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The password prompt, for either door.
 *
 * `router.refresh()` rather than a hard navigation on success: the page is a
 * server component that reads the cookie, so re-running it on the server with
 * the new cookie in hand is exactly the right amount of work — a full reload
 * would re-download the route for no reason.
 */
export function LoginForm({
  endpoint = "/api/kitchen/auth",
  title = "The Kitchen",
  sub = "The Kranti Cookbook — analytics",
  inputId = "kitchen-password",
}: {
  endpoint?: string;
  title?: string;
  sub?: string;
  inputId?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        setPassword("");
        router.refresh();
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "That did not work.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="k-login">
      <form className="k-login__card" onSubmit={onSubmit}>
        <h1 className="k-login__title">{title}</h1>
        <p className="k-login__sub">{sub}</p>

        <label className="k-login__label" htmlFor={inputId}>
          Password
        </label>
        <input
          id={inputId}
          className="k-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />

        {error ? (
          <p className="k-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="k-button k-button--primary"
          style={{ marginTop: 20, width: "100%" }}
          disabled={busy || !password}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
