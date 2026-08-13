"use client";

import { useState } from "react";

import type { ChatMessage } from "@/lib/chat/store";
import { kindOf } from "@/lib/chat/turn";
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
          }}
        />
      ) : message.mode === "indianize" ? (
        <IndianisationCard
          data={{ beats: message.beats ?? {}, streaming: Boolean(message.streaming) }}
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

  return (
    <div className="card thread-answer">
      {/* A reply turn arrives with its mode before its first token, so this can
          be mounted and still empty for a moment. The dots carry that moment;
          the caret alone did not read as anything. */}
      {body.trim() ? (
        <div className="thread-prose">
          {body.split(/\n{2,}/).map((para, i) => (
            <p key={i} style={{ margin: "0 0 0.7rem", lineHeight: 1.6 }}>
              {para}
            </p>
          ))}
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
          aria-label="Copy reply"
          style={{ marginTop: "0.7rem" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}
