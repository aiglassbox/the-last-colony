"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useDrawerExit } from "@/lib/use-drawer-exit";
import { trackClient } from "@/lib/analytics";
import type { CorpusRecord } from "@/lib/corpus/types";
import type { UiStrings } from "@/lib/lang/ui-strings";

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
  t,
  onClose,
}: {
  record: CorpusRecord;
  /** Labels in the card's language. The record's own text stays as the record has it. */
  t: UiStrings;
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

  const { requestClose, backdropClassName, drawerClassName, onAnimationEnd } =
    useDrawerExit(onClose);

  /**
   * Mounted on the body, not where it is written.
   *
   * This is rendered from inside the answer card, and `.thread` above it
   * carries a mask for its bottom fade. A mask creates a stacking context, so
   * a fixed-position dialog written inside one is sealed in it: `z-index: 50`
   * counted only against the card's own children, the composer painted over
   * the panel, and the backdrop stopped at the edge of the thread instead of
   * covering the rail. A portal takes the dialog out of that subtree
   * altogether, which is where a modal belongs anyway.
   */
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className={backdropClassName} onClick={requestClose} aria-hidden />
      <div
        className={drawerClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        onAnimationEnd={onAnimationEnd}
      >
        {/* Held at the top while the body moves under it: the panel is taller
            than the screen on most records, and a close button that scrolls
            away is one the reader has to go looking for. */}
        <div className="drawer__head">
          <div>
            <div className="mono" style={{ color: "var(--ink-muted)" }}>
              {t.sourceTitle}
            </div>
            <div id="source-title" className="display" style={{ fontSize: "1.2rem" }}>
              {record.source.text}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn drawer__close"
            onClick={requestClose}
            aria-label={t.close}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="drawer__body">

          <Row label={t.sourceAuthor} value={record.source.author} />
          <Row label={t.sourcePeriod} value={record.source.century} />
          <Row label={t.sourceRegion} value={record.region} />

          {verified ? (
            <>
              <Row label={t.sourceLocus} value={record.source.locus} />
              <Row label={t.sourceEdition} value={record.source.edition} />
              <Row label={t.sourcePage} value={record.source.page ? String(record.source.page) : null} />
              {record.original_text && (
                <Block label={t.sourceOriginal} value={record.original_text} serif />
              )}
              {record.transliteration && (
                <Block label={t.sourceTransliteration} value={record.transliteration} italic />
              )}
              {record.translation && <Block label={t.sourceTranslation} value={record.translation} />}
              <Row
                label={t.sourceCheckedBy}
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
                {t.sourceUnverified}
              </div>
              <p style={{ margin: 0, fontSize: "0.92rem", color: "var(--ink-soft)" }}>
                {record.verification.note}
              </p>
              <p style={{ margin: "0.7rem 0 0", fontSize: "0.92rem", color: "var(--ink-soft)" }}>
                {t.sourceUnverifiedNote}
              </p>
            </div>
          )}

          {record.contested_points.length > 0 && (
            <div style={{ marginTop: "1.4rem" }}>
              <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
                {t.sourceContested}
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
              {t.sourceConfidence}
            </div>
            <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
              {(["identification", "ingredients", "method"] as const).map((k) => (
                <div key={k}>
                  <div style={{ fontSize: "1.05rem" }}>
                    {Math.round(record.confidence[k] * 100)}%
                  </div>
                  <div className="mono" style={{ color: "var(--ink-muted)" }}>
                    {
                      {
                        identification: t.sourceIdentification,
                        ingredients: t.sourceIngredients,
                        method: t.sourceMethod,
                      }[k]
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
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
