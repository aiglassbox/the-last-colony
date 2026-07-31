"use client";

import { useEffect } from "react";

import { trackClient } from "@/lib/analytics";
import type { CorpusRecord } from "@/lib/corpus/types";

/**
 * The source drawer. Per the brief this is the credibility of the whole
 * campaign, so it is built to show one of two things and never a blur of the
 * two: either the verse, transliteration, translation, edition and page for a
 * checked record — or, for an unchecked one, an explicit statement that nobody
 * has opened the printed edition yet, and what is therefore being withheld.
 *
 * The second state is the one that matters. A drawer that showed a plausible
 * verse number for an unverified record is exactly the screenshot that would
 * end the campaign.
 */

export function SourceDrawer({
  record,
  onClose,
}: {
  record: CorpusRecord;
  onClose: () => void;
}) {
  const verified = record.verification.status === "editor_verified";

  useEffect(() => {
    trackClient("source_drawer_opened", {
      slug: record.slug,
      provenance: record.provenance_class,
      verified,
    });
  }, [record.slug, record.provenance_class, verified]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Source">
        <div style={{ padding: "1.2rem 1.2rem 2rem", maxWidth: 720, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <div className="mono" style={{ color: "var(--ink-muted)" }}>
                Source
              </div>
              <div className="display" style={{ fontSize: "1.2rem" }}>
                {record.source.text}
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
                fontSize: "1rem",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <Row label="Author" value={record.source.author} />
          <Row label="Period" value={record.source.century} />
          <Row label="Region" value={record.region} />

          {verified ? (
            <>
              <Row label="Locus" value={record.source.locus} />
              <Row label="Edition" value={record.source.edition} />
              <Row label="Page" value={record.source.page ? String(record.source.page) : null} />
              {record.original_text && (
                <Block label="Original" value={record.original_text} serif />
              )}
              {record.transliteration && (
                <Block label="Transliteration" value={record.transliteration} italic />
              )}
              {record.translation && <Block label="Translation" value={record.translation} />}
              <Row
                label="Checked by"
                value={
                  record.verification.checked_by
                    ? `${record.verification.checked_by}${
                        record.verification.checked_on
                          ? ` · ${record.verification.checked_on}`
                          : ""
                      }`
                    : null
                }
              />
            </>
          ) : (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.95rem 1rem",
                border: "1px dashed var(--line-strong)",
                borderRadius: 12,
                background: "transparent",
              }}
            >
              <div className="mono" style={{ color: "var(--reconstructed)", marginBottom: "0.5rem" }}>
                Citation not yet verified
              </div>
              <p style={{ margin: 0, fontSize: "0.92rem", color: "var(--ink-soft)" }}>
                {record.verification.note}
              </p>
              <p style={{ margin: "0.7rem 0 0", fontSize: "0.92rem", color: "var(--ink-soft)" }}>
                Until an editor has read the printed edition, this record shows no verse
                number, no page and no original-language text. What you see above is the
                text and period only.
              </p>
            </div>
          )}

          {record.contested_points.length > 0 && (
            <div style={{ marginTop: "1.4rem" }}>
              <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
                Where scholarship is contested
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--ink-soft)" }}>
                {record.contested_points.map((c) => (
                  <li key={c} style={{ marginBottom: "0.45rem", fontSize: "0.92rem" }}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: "1.4rem" }}>
            <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
              Confidence
            </div>
            <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
              {(["identification", "ingredients", "method"] as const).map((k) => (
                <div key={k}>
                  <div style={{ fontSize: "1.05rem" }}>
                    {Math.round(record.confidence[k] * 100)}%
                  </div>
                  <div className="mono" style={{ color: "var(--ink-muted)" }}>
                    {k}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: "1rem", padding: "0.4rem 0", borderBottom: "1px solid var(--line)" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", minWidth: 100 }}>
        {label}
      </div>
      <div style={{ fontSize: "0.95rem" }}>{value}</div>
    </div>
  );
}

function Block({
  label,
  value,
  serif,
  italic,
}: {
  label: string;
  value: string;
  serif?: boolean;
  italic?: boolean;
}) {
  return (
    <div style={{ marginTop: "1.1rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.4rem" }}>
        {label}
      </div>
      <p
        className={serif ? "display" : undefined}
        style={{
          margin: 0,
          fontSize: serif ? "1.15rem" : "0.98rem",
          fontStyle: italic ? "italic" : undefined,
          lineHeight: 1.7,
          color: "var(--ink)",
        }}
      >
        {value}
      </p>
    </div>
  );
}
