"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage, Conversation } from "@/lib/chat/store";
import { KIND_COLOUR, KIND_LABEL } from "@/lib/dash/tokens";
import type { ThreadSummary } from "@/lib/dash/types";

import { Panel } from "./ui/Panel";

/**
 * Reading the actual conversations.
 *
 * Aggregates can say the corpus hit rate is 71%. They cannot say that the miss
 * was a reader asking about their grandmother's version of a dish we do hold,
 * in words the retriever did not match — and that class of failure is the one
 * worth finding, because it is a retrieval bug wearing a corpus gap's clothes.
 *
 * Fetched rather than server-rendered because a conversation row carries whole
 * corpus records in its `data`; sending two hundred of those with the page to
 * show a list of titles would be megabytes for markup nobody has scrolled to.
 */

interface Props {
  range: string;
}

export function Threads({ range }: Props) {
  const [rows, setRows] = useState<ThreadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Every list fetch is numbered, and a response is dropped unless it belongs
     to the newest one. Without this, typing "dosa" fires four overlapping
     requests and whichever the network returns last wins — which is regularly
     the one for "do". */
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ range, page: String(page), search });
      const response = await fetch(`/api/kitchen/threads?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: ThreadSummary[]; total: number };
      if (id !== requestId.current) return;
      setRows(body.rows);
      setTotal(body.total);
    } catch {
      if (id === requestId.current) setError("Could not load threads.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range, page, search]);

  useEffect(() => {
    // Debounced, so a search is one request per pause rather than per keystroke.
    const timer = setTimeout(() => void load(), search ? 280 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function open(id: string) {
    setSelected(null);
    try {
      const response = await fetch(`/api/kitchen/threads?id=${encodeURIComponent(id)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { conversation: Conversation };
      setSelected(body.conversation);
    } catch {
      setError("Could not load that thread.");
    }
  }

  const pages = Math.ceil(total / 30);

  return (
    <div className="k-grid">
      <Panel
        title="Threads"
        note="Device ids are truncated to eight characters — enough to tell one reader's threads from another's, not enough to use as a key against the mirror."
        span={12}
        right={<span style={{ fontSize: 12, color: "var(--ink-3)" }}>{total} in this window</span>}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            className="k-input"
            style={{ maxWidth: 320 }}
            type="search"
            placeholder="Search titles and message text…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // A new search makes the current page number meaningless. Reset
              // it here rather than in an effect watching `search`: the effect
              // would run a render later, so one list fetch would go out for
              // the new term at the old offset before the reset landed.
              setPage(0);
            }}
            aria-label="Search threads"
          />
          {pages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                className="k-button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Newer
              </button>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {page + 1} / {pages}
              </span>
              <button
                className="k-button"
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
              >
                Older →
              </button>
            </div>
          )}
        </div>

        {error ? <p className="k-error">{error}</p> : null}

        <div className="k-threads">
          <div className="k-thread-list">
            {loading && !rows.length ? <p className="k-empty">Loading…</p> : null}
            {!loading && !rows.length ? <p className="k-empty">No threads match.</p> : null}
            {rows.map((row) => (
              <button
                key={row.id}
                className="k-thread"
                aria-pressed={selected?.id === row.id}
                onClick={() => void open(row.id)}
              >
                <span className="k-thread__title">{row.title}</span>
                <span className="k-thread__meta">
                  <span>{row.createdAt}</span>
                  <span>· {Math.max(1, Math.round(row.messages / 2))}q</span>
                  <span>· {row.device}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="k-reader">
            {selected ? (
              <Transcript conversation={selected} />
            ) : (
              <p className="k-empty">Pick a thread to read it.</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/**
 * The stored text of a restoration turn is the beat markers with their content
 * stripped out, which leaves runs of five and six blank lines. The card never
 * shows them because it renders from `beats`; a transcript shows the raw text,
 * so the runs are collapsed to a single blank line here. Deliberately a display
 * concern and not a fix at the source — what is stored is what the app replays
 * to the model, and it should stay byte-identical to what the app wrote.
 */
const BLANK_RUN = /\n{3,}/g;

function readable(text: string | undefined): string {
  return (text ?? "").replace(BLANK_RUN, "\n\n").trim() || "—";
}

function Transcript({ conversation }: { conversation: Conversation }) {
  const messages = useMemo(
    () => (Array.isArray(conversation.messages) ? conversation.messages : []),
    [conversation],
  );

  return (
    <div>
      {messages.map((message: ChatMessage, index: number) => {
        const kind = message.kind;
        return (
          <div
            key={message.id ?? index}
            className={`k-msg ${message.role === "user" ? "k-msg--user" : ""}`}
          >
            <div className="k-msg__role">
              <span>{message.role === "user" ? "Reader" : "Reply"}</span>
              {kind ? (
                <span
                  className="k-pill"
                  style={{ color: KIND_COLOUR[kind] ?? "var(--ink-3)" }}
                >
                  {KIND_LABEL[kind] ?? kind}
                </span>
              ) : null}
              {message.error ? (
                <span className="k-pill" style={{ color: "var(--critical)" }}>
                  failed
                </span>
              ) : null}
            </div>

            <p className="k-msg__text">{readable(message.text)}</p>

            {message.records?.length ? (
              <div className="k-msg__records">
                {message.records.map((record) => (
                  <span key={record.slug}>
                    {record.slug} · {record.provenance_class}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
