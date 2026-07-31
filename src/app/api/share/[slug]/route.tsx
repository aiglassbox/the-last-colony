import { ImageResponse } from "next/og";

import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";

/**
 * The 1080×1350 share card — how the campaign travels on Independence Day.
 *
 * Everything on it is composed from the record. There is no model call here on
 * purpose: an image is the artefact most likely to be screenshotted, quoted
 * and fact-checked, so nothing on it should be generated. The headline is
 * built from the first entry in the record's substitution story, which means
 * it is as defensible as the corpus is.
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

export async function GET(_request: Request, ctx: RouteContext<"/api/share/[slug]">) {
  const { slug } = await ctx.params;
  const record = await fileCorpus.bySlug(slug);
  if (!record) return new Response("Not found", { status: 404 });

  const counterpart = record.modern_counterpart_id
    ? await fileCorpus.byId(record.modern_counterpart_id)
    : null;

  const then = record.ingredients.slice(0, 5).map((i) => i.name);
  const now = (counterpart?.ingredients ?? []).slice(0, 5).map((i) => i.name);

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
          {record.dish_name_source
            ? `${record.dish_name_source} → ${record.dish_name_modern}`
            : record.dish_name_modern}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 22,
            fontSize: 82,
            lineHeight: 1.08,
            fontWeight: 600,
            letterSpacing: -1.5,
          }}
        >
          {headline(record)}
        </div>

        <div style={{ display: "flex", flex: 1 }} />

        {(then.length > 0 || now.length > 0) && (
          <div style={{ display: "flex", gap: 28 }}>
            <Column title="Then" colour={THEN} items={then} />
            <Column title="Now" colour={NOW} items={now} />
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 56,
            paddingTop: 28,
            borderTop: `2px solid rgba(26,23,18,0.18)`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: INK_SOFT }}>
              {record.provenance_class === "MODERN_DISH"
                ? "Component restoration"
                : record.source.text}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: NOW, marginTop: 6 }}>
              {CLASS_LABEL[record.provenance_class]}
              {record.verification.status !== "editor_verified"
                ? " · citation not yet verified"
                : ""}
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
