"use client";

import { useState } from "react";

import type { ChatMessage } from "@/lib/chat/store";
import { kindOf } from "@/lib/chat/turn";
import { uiStrings } from "@/lib/lang/ui-strings";
import { toPlainText } from "@/lib/model/plain-text";

import { IndianisationCard } from "./IndianisationCard";
import { RestorationCard, Waiting } from "./RestorationCard";

/**
 * One turn in the thread.
 *
 * User turns are a bubble. Assistant turns sit on a card — not because the
 * text needs a frame, but because the ground here is a painting. Prose set
 * straight onto it competes with the artwork behind every line, which is what
 * a follow-up answer used to do.
 */

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div
        data-message-id={message.id}
        style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 1.1rem" }}
      >
        <div className="bubble-user">{message.text}</div>
      </div>
    );
  }

  return (
    <div data-message-id={message.id} style={{ margin: "0 0 1.6rem" }}>
      {/* Before the server has said which kind of turn this is there is nothing
          to draw — no card, no prose, not even a mode. That window used to
          render an empty prose block with a caret blinking in it, which on this
          background is indistinguishable from nothing happening at all, and
          then the finished answer arrived in one piece. */}
      {!message.mode && message.streaming ? (
        <Thinking />
      ) : message.mode === "restoration" ? (
        <RestorationCard
          data={{
            records: message.records ?? [],
            query: message.query,
            kind: kindOf(message),
            beats: message.beats ?? {},
            streaming: Boolean(message.streaming),
            localized: message.localized,
            lang: message.lang,
          }}
        />
      ) : message.mode === "indianize" ? (
        <IndianisationCard
          data={{
            beats: message.beats ?? {},
            streaming: Boolean(message.streaming),
            lang: message.lang,
          }}
        />
      ) : (
        <ProseTurn message={message} />
      )}

      {message.error && (
        <p
          style={{
            margin: "0.6rem 0 0",
            fontSize: "0.86rem",
            color: "var(--orange)",
            maxWidth: "62ch",
          }}
        >
          {message.error}
        </p>
      )}
    </div>
  );
}

/**
 * Split a reply into paragraphs and comparison tables.
 *
 * A row is a line with two `::` separators, which is the shape the recipe table
 * already uses — one convention for "this is tabular", not a second one the
 * model has to remember. Consecutive rows are one table; anything else is a
 * paragraph. A run of one row is left as prose, because a single line that
 * happens to contain the separator is far more likely to be a sentence than a
 * table of one.
 */
type Block = { text: string; rows?: string[][] };

function blocks(body: string): Block[] {
  const out: Block[] = [];
  let rows: string[][] = [];
  let para: string[] = [];

  const flushRows = () => {
    if (rows.length > 1) out.push({ text: "", rows });
    else if (rows.length === 1) para.push(rows[0].join(" :: "));
    rows = [];
  };
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) out.push({ text });
    para = [];
  };

  for (const line of body.split("\n")) {
    const cells = line.split("::").map((c) => c.trim());
    if (cells.length === 3 && cells.some(Boolean)) {
      flushPara();
      rows.push(cells);
      continue;
    }
    flushRows();
    if (!line.trim()) flushPara();
    else para.push(line);
  }
  flushRows();
  flushPara();
  return out;
}

/** Then against now, as the reader asked to see it. */
function ComparisonTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="scroll-x">
      <table className="compare">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} className="mono" scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The turn before it has a shape: a card holding the same dots the beats use. */
function Thinking() {
  return (
    <div className="card thread-answer">
      <Waiting />
    </div>
  );
}

function ProseTurn({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied — not worth surfacing.
    }
  };

  const body = toPlainText(message.text);
  // The copy control belongs to this turn, so it speaks this turn's language.
  const t = uiStrings(message.lang);

  return (
    <div className="card thread-answer">
      {/* A reply turn arrives with its mode before its first token, so this can
          be mounted and still empty for a moment. The dots carry that moment;
          the caret alone did not read as anything. */}
      {body.trim() ? (
        <div className="thread-prose">
          {blocks(body).map((block, i) =>
            block.rows ? (
              <ComparisonTable key={i} rows={block.rows} />
            ) : (
              <p key={i} style={{ margin: "0 0 0.7rem", lineHeight: 1.6 }}>
                {block.text}
              </p>
            ),
          )}
          {message.streaming && <span className="caret" aria-hidden />}
        </div>
      ) : (
        message.streaming && <Waiting />
      )}

      {!message.streaming && message.text.trim() && (
        <button
          type="button"
          onClick={copy}
          className="mono ghost-btn"
          aria-label={t.copyReply}
          style={{ marginTop: "0.7rem" }}
        >
          {copied ? t.copied : t.copy}
        </button>
      )}
    </div>
  );
}
