import { ImageResponse } from "next/og";

import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";

/**
 * The 1080×1350 share card — how the campaign travels on Independence Day.
 *
 * For a record, everything on it is composed from that record. There is no
 * model call here on purpose: an image is the artefact most likely to be
 * screenshotted, quoted and fact-checked, so nothing citational on it should be
 * generated. The headline comes from the record's own editorial verdict, which
 * makes it as defensible as the corpus is.
 *
 * Half the turns have no record — a modern dish, a foreign dish, a corpus gap —
 * and those cards had no share at all, which is most of the product unable to
 * travel. `/api/share/turn` renders the same layout from what the card is
 * already showing, passed in the query string.
 *
 * That is not a hole in the rule above. The rule is about provenance: a text, a
 * verse, a period, a class. A turn card claims none of those. It states plainly
 * that the dish has no ancient original, and its footer says so where a record
 * card would name its source.
 *
 * Satori supports flexbox only — no CSS grid.
 */

const PAPER = "#f4efe3";
const INK = "#1a1712";
const INK_SOFT = "#5a5044";
const THEN = "#7a2e22";
const NOW = "#6b7280";

const CLASS_LABEL: Record<string, string> = {
  ATTESTED: "Attested",
  RECONSTRUCTED: "Reconstructed",
  INFERRED: "Inferred",
  MODERN_DISH: "Modern dish",
};

/** Everything the layout needs, from either source. */
interface CardCopy {
  dishLine: string;
  headline: string;
  then: string[];
  now: string[];
  thenLabel: string;
  nowLabel: string;
  /** Numbered steps. A card called a recipe card has to carry the method. */
  steps: string[];
  footerTitle: string;
  footerNote: string;
}

function headline(r: CorpusRecord): string {
  if (r.share_verdict) return r.share_verdict;
  // Fallback for a record whose verdict has not been written yet. True, but
  // rarely quotable — write `share_verdict` on any record that ships.
  const change = r.substitution_story?.changed[0];
  if (r.provenance_class === "MODERN_DISH") {
    return `${r.dish_name_modern} has no ancient original.`;
  }
  if (change) return `${change.from} became ${change.to}.`;
  return `${r.dish_name_modern} was not always ${r.dish_name_modern}.`;
}

function fromRecord(record: CorpusRecord, counterpart: CorpusRecord | null): CardCopy {
  // Which column the record's own ingredients belong in depends on where the
  // record sits in time. A modern dish has no ancestor to diff against, so its
  // ingredients are the Now — filing potato, tomato and pav under THEN would
  // claim exactly the history the record was written to deny.
  const own = record.ingredients.slice(0, 5).map((i) => i.name);
  const other = (counterpart?.ingredients ?? []).slice(0, 5).map((i) => i.name);
  const isModern = record.provenance_class === "MODERN_DISH";

  return {
    dishLine: record.dish_name_source
      ? `${record.dish_name_source} → ${record.dish_name_modern}`
      : record.dish_name_modern,
    headline: headline(record),
    then: isModern ? other : own,
    now: isModern ? own : other,
    thenLabel: "Then",
    nowLabel: "Now",
    // A record card already carries the Then/Now diff, which is its argument.
    // The method is the practical half and has to fit under it, so it is the
    // one that gives: five steps, not seven.
    steps: (record.restore_today?.steps ?? record.method_reconstructed ?? []).slice(0, 5),
    footerTitle: isModern ? "Component restoration" : record.source.text,
    footerNote:
      CLASS_LABEL[record.provenance_class] +
      (record.verification.status !== "editor_verified" ? " · citation not yet verified" : ""),
  };
}

/** Anything arriving in a URL is untrusted, and this one paints a branded image. */
function clamp(value: string | null, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fromParams(params: URLSearchParams): CardCopy | null {
  const dish = clamp(params.get("dish"), 60);
  const headlineText = clamp(params.get("verdict"), 140);
  if (!dish || !headlineText) return null;

  const list = (key: string, max = 5) =>
    (params.get(key) ?? "")
      .split("|")
      .map((s) => clamp(s, 120))
      .filter(Boolean)
      .slice(0, max);

  return {
    dishLine: dish,
    headline: headlineText,
    then: list("then"),
    now: list("now"),
    thenLabel: clamp(params.get("thenLabel"), 18) || "Then",
    nowLabel: clamp(params.get("nowLabel"), 18) || "Now",
    steps: list("steps", 7),
    footerTitle: clamp(params.get("note"), 48) || "No ancient original",
    footerNote: clamp(params.get("kind"), 48) || "Not drawn from a text",
  };
}

export async function GET(request: Request, ctx: RouteContext<"/api/share/[slug]">) {
  const { slug } = await ctx.params;

  let copy: CardCopy | null;
  if (slug === "turn") {
    copy = fromParams(new URL(request.url).searchParams);
  } else {
    const record = await fileCorpus.bySlug(slug);
    if (!record) return new Response("Not found", { status: 404 });
    const counterpart = record.modern_counterpart_id
      ? await fileCorpus.byId(record.modern_counterpart_id)
      : null;
    copy = fromRecord(record, counterpart);
  }
  if (!copy) return new Response("Not found", { status: 404 });

  // 1080×1350 is fixed, so something has to yield when the card is full. The
  // headline does: it is the loudest element and the one with the most slack.
  // 1080×1350 is fixed and Satori does not clip, it overlaps — so anything that
  // does not fit lands on top of what does. Everything below is measured
  // against that: rough character counts, deliberately pessimistic.
  const stepLoad = copy.steps.join(" ").length;
  const listLoad = [...copy.then, ...copy.now].join(" ").length;
  const load = copy.headline.length + stepLoad + listLoad;

  const headlineSize =
    copy.steps.length === 0 ? 82 : load > 900 ? 46 : load > 700 ? 52 : load > 500 ? 60 : 70;
  const stepSize = stepLoad > 560 ? 22 : 25;
  // Two columns and a method together is the tightest case in the layout.
  const columnRows = copy.steps.length > 0 && copy.then.length > 0 && copy.now.length > 0 ? 4 : 5;
  const then = copy.then.slice(0, columnRows);
  const now = copy.now.slice(0, columnRows);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1350px",
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          color: INK,
          padding: "78px 72px",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: THEN,
          }}
        >
          The Great Indian Food Restoration
        </div>

        <div style={{ display: "flex", marginTop: 54, fontSize: 34, color: INK_SOFT }}>
          {copy.dishLine}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 22,
            fontSize: headlineSize,
            lineHeight: 1.08,
            fontWeight: 600,
            letterSpacing: -1.5,
          }}
        >
          {copy.headline}
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 24 }} />

        {(then.length > 0 || now.length > 0) && (
          <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
            {then.length > 0 && <Column title={copy.thenLabel} colour={THEN} items={then} />}
            {now.length > 0 && <Column title={copy.nowLabel} colour={NOW} items={now} />}
          </div>
        )}

        {copy.steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            <div
              style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: NOW }}
            >
              METHOD
            </div>
            {copy.steps.map((step, i) => (
              <div
                key={i}
                style={{ display: "flex", marginTop: 10, fontSize: stepSize, lineHeight: 1.32 }}
              >
                <div style={{ display: "flex", color: THEN, width: 38, flexShrink: 0 }}>
                  {`${i + 1}.`}
                </div>
                <div style={{ display: "flex", flex: 1 }}>{step}</div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 34,
            paddingTop: 24,
            borderTop: `2px solid rgba(26,23,18,0.18)`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: INK_SOFT }}>
              {copy.footerTitle}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: NOW, marginTop: 6 }}>
              {copy.footerNote}
            </div>
          </div>
          <div style={{ display: "flex", flex: 1 }} />
          <div style={{ display: "flex", fontSize: 26, color: THEN, letterSpacing: 3 }}>
            VITALIFE
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );
}

function Column({
  title,
  colour,
  items,
}: {
  title: string;
  colour: string;
  items: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        border: `2px solid ${colour}`,
        borderRadius: 20,
        padding: "26px 28px",
      }}
    >
      <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: colour }}>
        {title.toUpperCase()}
      </div>
      {items.map((i) => (
        <div key={i} style={{ display: "flex", fontSize: 30, marginTop: 14 }}>
          {i}
        </div>
      ))}
    </div>
  );
}
