"use client";

import { useState } from "react";

import type { ChatMessage } from "@/lib/chat/store";
import { toPlainText } from "@/lib/model/plain-text";

import { RestorationCard } from "./RestorationCard";

/**
 * One turn in the thread.
 *
 * User turns are a bubble. Assistant turns are not — the same choice Claude
 * and Gemini make, because assistant text is long-form and a bubble around a
 * four-beat card would fight the card's own frame.
 */

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 1.1rem" }}>
        <div className="bubble-user">{message.text}</div>
      </div>
    );
  }

  return (
    <div style={{ margin: "0 0 1.6rem" }}>
      {message.mode === "restoration" ? (
        <RestorationCard
          data={{
            records: message.records ?? [],
            empty: Boolean(message.empty),
            beats: message.beats ?? {},
            streaming: Boolean(message.streaming),
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

  return (
    <div>
      <div className="thread-prose" style={{ maxWidth: "62ch" }}>
        {toPlainText(message.text)
          .split(/\n{2,}/)
          .map((para, i) => (
            <p key={i} style={{ margin: "0 0 0.7rem", lineHeight: 1.6 }}>
              {para}
            </p>
          ))}
        {message.streaming && <span className="caret" aria-hidden />}
      </div>

      {!message.streaming && message.text.trim() && (
        <button
          type="button"
          onClick={copy}
          className="mono ghost-btn"
          aria-label="Copy reply"
          style={{ marginTop: "0.2rem" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}
