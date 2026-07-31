"use client";

import { useEffect, useState } from "react";

import type { SwapRecord } from "@/lib/corpus/types";

/**
 * The ingredient swap tool. Bottom sheet on mobile, which is the only surface
 * that matters here.
 *
 * Ratios, taste consequences and rationale render from the swap records, not
 * from generation — a made-up substitution ratio is the same class of failure
 * as a made-up verse, just quieter. The model contributes one framing
 * paragraph, and the sheet works fine without it.
 */

interface SwapResult {
  query: string;
  record: SwapRecord | null;
}

export function SwapPanel({
  mode,
  initialItem,
  onClose,
}: {
  mode: "single" | "pantry";
  /** Prefilled and run immediately — used by the "Oil Match" quick action. */
  initialItem?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialItem ?? "");
  const [results, setResults] = useState<SwapResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/swap")
      .then((r) => r.json())
      .then((d: { items: string[] }) => setKnown(d.items))
      .catch(() => setKnown([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (raw: string) => {
    const items = raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as { results: SwapResult[]; note: string | null };
      setResults(data.results);
      setNote(data.note);
    } catch {
      setResults(items.map((query) => ({ query, record: null })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Ingredient swaps">
        <div style={{ padding: "1.2rem 1.15rem 2.4rem", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "0.9rem" }}>
            <div>
              <div className="mono" style={{ color: "var(--ink-muted)" }}>
                Swap tool
              </div>
              <div className="display" style={{ fontSize: "1.2rem" }}>
                {mode === "pantry" ? "Read my pantry" : "Swap an ingredient"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                marginLeft: "auto",
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--ink)",
                borderRadius: 999,
                width: 34,
                height: 34,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(text);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={mode === "pantry" ? 5 : 2}
              placeholder={
                mode === "pantry"
                  ? "Paste 5–15 pantry items, one per line or comma separated"
                  : "sugar"
              }
              style={{
                width: "100%",
                padding: "0.7rem 0.85rem",
                borderRadius: 12,
                border: "1px solid var(--line-strong)",
                background: "var(--surface-2)",
                color: "var(--ink)",
                font: "inherit",
                resize: "vertical",
              }}
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              style={{
                marginTop: "0.6rem",
                padding: "0.6rem 1.1rem",
                borderRadius: 999,
                border: 0,
                background: busy ? "var(--ink-muted)" : "var(--orange)",
                color: "#fff",
                font: "inherit",
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "Reading…" : mode === "pantry" ? "Read pantry" : "Find swaps"}
            </button>
          </form>

          {!results && known.length > 0 && (
            <div style={{ marginTop: "1.1rem" }}>
              <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
                We can speak to
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {known.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setText(k);
                      void run(k);
                    }}
                    style={{
                      padding: "0.35rem 0.7rem",
                      borderRadius: 999,
                      border: "1px solid var(--line-strong)",
                      background: "transparent",
                      color: "var(--ink-soft)",
                      font: "inherit",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}

          {note && (
            <p style={{ marginTop: "1.1rem", color: "var(--ink-soft)", maxWidth: "60ch" }}>
              {note}
            </p>
          )}

          {results?.map(({ query, record }) => (
            <div key={query} style={{ marginTop: "1.3rem" }}>
              <div className="display" style={{ fontSize: "1.05rem" }}>
                {record ? record.modern_item : query}
              </div>

              {!record && (
                <p style={{ margin: "0.3rem 0 0", color: "var(--ink-soft)", fontSize: "0.9rem" }}>
                  No swap record for this yet. Rather than guess a ratio, we would rather say
                  so — it has been logged.
                </p>
              )}

              {record?.options.map((o, i) => (
                <div
                  key={o.swap}
                  style={{
                    marginTop: "0.6rem",
                    padding: "0.8rem 0.9rem",
                    borderRadius: 12,
                    border: "1px solid var(--line-strong)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                    <span className="mono" style={{ color: "var(--orange)" }}>
                      {i + 1}
                    </span>
                    <strong>{o.swap}</strong>
                  </div>
                  <Line label="Ratio" value={o.ratio} />
                  <Line label="Taste & texture" value={o.taste_and_texture} />
                  <Line label="Why" value={o.nutritional_rationale} />
                </div>
              ))}

              {record && (
                <p
                  style={{
                    margin: "0.6rem 0 0",
                    fontSize: "0.85rem",
                    color: "var(--ink-muted)",
                    maxWidth: "60ch",
                  }}
                >
                  <span className="mono">Where it went · </span>
                  {record.where_it_went}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ margin: "0.45rem 0 0", fontSize: "0.88rem", color: "var(--ink-soft)" }}>
      <span className="mono" style={{ color: "var(--ink-muted)" }}>
        {label}{" "}
      </span>
      {value}
    </p>
  );
}
