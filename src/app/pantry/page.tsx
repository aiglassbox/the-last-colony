import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getSubmission,
  listSubmissions,
  PAGE_SIZE,
  type StoredSubmission,
} from "@/lib/community/client";
import { pantryAccess } from "@/lib/dash/auth";

import { LoginForm } from "../kitchen/LoginForm";
import { LogoutButton } from "../kitchen/LogoutButton";
import { Actions } from "./Actions";

/**
 * The pantry: every community submission, by verdict, with the operator's
 * three powers — override, re-run, download as a corpus candidate.
 *
 * A server component that reads the cookie and then the store directly; state
 * lives in the URL (status, page, id) like the kitchen's, so a link to one
 * submission is shareable between the three people who hold the password.
 *
 * This is the one place `contact` is shown. Nothing here is served to readers.
 */

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "green", "red"] as const;
type Status = (typeof STATUSES)[number];

function asStatus(value: unknown): Status {
  return STATUSES.some((s) => s === value) ? (value as Status) : "pending";
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const ist = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function Pantry(props: PageProps<"/pantry">) {
  const access = await pantryAccess();

  /* No password configured is not "open to everyone", it is "not here". */
  if (access === "unconfigured") notFound();
  if (access === "denied") {
    return (
      <LoginForm
        endpoint="/api/pantry/auth"
        title="The Pantry"
        sub="The Kranti Cookbook — community submissions"
        inputId="pantry-password"
      />
    );
  }

  const params = await props.searchParams;
  const status = asStatus(one(params.status));
  // Finite, positive, whole: a fractional page or 1e999 reaches Mongo as a
  // skip it rejects, which reads to the operator as "the store is unreachable".
  const pageRaw = Number(one(params.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 0;
  const id = one(params.id);

  const header = (
    <header className="k-head">
      <div>
        <h1 className="k-head__title">The Pantry</h1>
        <p className="k-head__sub">Community submissions · all times India Standard Time</p>
      </div>
      <div className="k-head__actions">
        <LogoutButton endpoint="/api/pantry/auth" />
      </div>
    </header>
  );

  if (id) {
    const doc = await getSubmission(id);
    return (
      <div className="kitchen__inner">
        {header}
        <p>
          <Link href={`/pantry?status=${status}&page=${page}`} prefetch={false}>
            ← Back to {status}
          </Link>
        </p>
        {doc ? <Detail doc={doc} /> : <p className="k-caveat">No such submission, or the store is unavailable.</p>}
      </div>
    );
  }

  const list = await listSubmissions(status, page);
  const pages = list ? Math.ceil(list.total / PAGE_SIZE) : 0;

  return (
    <div className="kitchen__inner">
      {header}

      <nav className="k-tabs" aria-label="Verdict">
        {STATUSES.map((s) => (
          <Link
            key={s}
            className="k-tab"
            href={`/pantry?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            prefetch={false}
          >
            {s}
          </Link>
        ))}
      </nav>

      {!list ? (
        <p className="k-caveat">
          No <strong>ATLAS_URL</strong> on this deployment, or the store is unreachable — nothing to read.
        </p>
      ) : (
        <section className="k-panel k-span-12">
          <div className="k-panel__head">
            <h2 className="k-panel__title">
              {status} · {list.total}
            </h2>
          </div>
          <div className="k-panel__body">
            {list.rows.length === 0 ? (
              <p className="k-empty">Nothing here.</p>
            ) : (
              <table className="k-table">
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Recipe</th>
                    <th>By</th>
                    <th>State</th>
                    <th>Mode</th>
                    <th>Tag</th>
                    <th>Photo</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{ist(r.created_at)}</td>
                      <td>
                        <Link href={`/pantry?status=${status}&page=${page}&id=${r.id}`} prefetch={false}>
                          {r.recipe_name}
                        </Link>
                        {r.overridden ? <span className="p-pill p-pill--override">override</span> : null}
                      </td>
                      <td>{r.display_name}</td>
                      <td>{r.state}</td>
                      <td>{r.mode}</td>
                      <td>{r.dish_tag ?? "—"}</td>
                      <td>{r.has_photo ? "yes" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pages > 1 ? (
              <nav className="p-pager" aria-label="Pages">
                {page > 0 ? (
                  <Link className="k-button" href={`/pantry?status=${status}&page=${page - 1}`} prefetch={false}>
                    ← Newer
                  </Link>
                ) : null}
                <span>
                  page {page + 1} of {pages}
                </span>
                {page + 1 < pages ? (
                  <Link className="k-button" href={`/pantry?status=${status}&page=${page + 1}`} prefetch={false}>
                    Older →
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

/** Submitted words beside what the model read; verdict, contact and geo in the side panel; the photo below. */
function Detail({ doc }: { doc: StoredSubmission }) {
  const s = doc.submission;
  const rows: Array<[string, string | null, string | null | undefined]> = [
    ["Recipe name", s.recipe_name, doc.extracted?.recipe_name],
    ["Story", s.story, doc.extracted?.story],
    ["Ingredients", s.ingredients, doc.extracted?.ingredients],
    ["Method", s.method, doc.extracted?.method],
    ["Language", doc.dish?.language || (s as { language?: string }).language || null, null],
  ];
  const geo = [doc.geo.country, doc.geo.region, doc.geo.city, doc.geo.timezone].filter(Boolean).join(" · ");

  return (
    <div className="k-grid">
      <section className="k-panel k-span-8">
        <div className="k-panel__head">
          <h2 className="k-panel__title">
            {s.recipe_name}
            <span className={`p-pill p-pill--${doc.status}`}>{doc.status}</span>
          </h2>
        </div>
        <p className="k-panel__note">
          {s.display_name} · {s.belongs_to}
          {s.belongs_to_other ? ` (${s.belongs_to_other})` : ""} · {s.state}
          {s.city ? `, ${s.city}` : ""} · {doc.mode} · {ist(doc.created_at)}
        </p>
        <div className="k-panel__body">
          <table className="k-table p-side">
            <thead>
              <tr>
                <th>Field</th>
                <th>Submitted (verbatim)</th>
                {doc.extracted ? <th>What the model read</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, sent, read]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="p-pre">{sent ?? "—"}</td>
                  {doc.extracted ? <td className="p-pre p-muted">{read || "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="k-panel k-span-4">
        <div className="k-panel__head">
          <h2 className="k-panel__title">Verdict</h2>
        </div>
        <div className="k-panel__body">
          {doc.verdict ? (
            <dl className="p-kv">
              <dt>Card</dt>
              <dd>
                {doc.verdict.card}
                {doc.verdict.overridden_at ? ` — overridden ${ist(doc.verdict.overridden_at)}` : ""}
              </dd>
              <dt>Model</dt>
              <dd>{doc.verdict.model}</dd>
              <dt>At</dt>
              <dd>{ist(doc.verdict.at)}</dd>
              <dt>Reasons</dt>
              <dd>{doc.verdict.reasons.length ? doc.verdict.reasons.join("; ") : "—"}</dd>
              <dt>Dish tag</dt>
              <dd>{doc.dish?.tag ?? "—"}</dd>
              <dt>Aliases</dt>
              <dd>{doc.dish?.aliases.join(", ") || "—"}</dd>
            </dl>
          ) : (
            <p className="k-empty">No verdict yet — the AI pass failed or has not run.</p>
          )}
          <Actions id={doc.id} status={doc.status} overridden={Boolean(doc.verdict?.overridden_at)} />

          <h3 className="p-h3">Contact (never shown to readers)</h3>
          <p className="p-pre">{s.contact}</p>

          <h3 className="p-h3">Edge geo at submit (audit only)</h3>
          <p className="p-muted">{geo || "none (localhost)"}</p>
        </div>
      </section>

      {s.photo ? (
        <section className="k-panel k-span-12">
          <div className="k-panel__head">
            <h2 className="k-panel__title">Photo · {Math.round(s.photo.bytes / 1024)} KB</h2>
          </div>
          <div className="k-panel__body">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the store; there is nothing for next/image to optimise */}
            <img className="p-photo" src={`data:${s.photo.mime};base64,${s.photo.data}`} alt={`Photo submitted with ${s.recipe_name}`} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
