/**
 * The dashboard's colour, and where every value in it came from.
 *
 * None of these were picked by eye. The categorical slots were searched over
 * the OKLCH space around six brand-adjacent hues and kept only if they cleared
 * all of: the dark lightness band (L 0.48–0.67), the chroma floor (C >= 0.10),
 * adjacent-pair separation under simulated protanopia and deuteranopia
 * (ΔE >= 8 in OKLab x100), the normal-vision floor (ΔE >= 15) and 3:1 contrast
 * against the panel. The winning set measures:
 *
 *   worst adjacent pair, CVD ......... ΔE 14.5 (deutan)   target >= 8
 *   worst adjacent pair, normal ...... ΔE 17.2            floor  >= 15
 *   contrast vs panel ................ all six >= 3:1
 *   first three, all-pairs CVD ....... ΔE 14.5            target >= 8
 *
 * The first three additionally clear the all-pairs test, which is the harder
 * one and the only one that counts where any two marks can end up adjacent —
 * so scatter-like forms here use at most three series.
 *
 * Two constraints came from the product rather than from the validator. There
 * is no green slot: the ground is a Phad painting in brand green, and a green
 * series on it competes with the page. And slot 1 is the brand amber, because
 * a single-series bar chart — which most of these are — should read as this
 * product and not as a generic dashboard.
 */

/** The panel every mark is measured against. Contrast numbers are meaningless without it. */
export const SURFACE = "#182610";
/** The plane the panels sit on. Separated by a hairline, not by luminance. */
export const PLANE = "#101a0a";

/**
 * Identity. Assigned in order, never cycled — a ninth series is folded into
 * "other" or given its own chart, never handed a generated hue.
 */
export const SERIES = [
  "#bd8a0a", // 1 amber      — the brand, and the default single-series fill
  "#ab575e", // 2 rose
  "#7762d6", // 3 indigo
  "#33a5b2", // 4 teal
  "#d15d15", // 5 terracotta
  "#bc59a3", // 6 plum
] as const;

/** The three that survive the all-pairs test, for forms where any two marks can touch. */
export const SERIES_SCATTER = SERIES.slice(0, 3);

/**
 * Magnitude, one hue, low→high. On a dark ground the anchor flips: the lowest
 * step recedes toward the panel rather than toward white, so an empty cell in
 * the heatmap reads as empty instead of as a value.
 */
export const SEQUENTIAL = [
  "#41300d",
  "#5b4313",
  "#745717",
  "#8e6919",
  "#a87c1a",
  "#c39019",
  "#e5ab25",
] as const;

/**
 * Position in a sequence — funnel stages, which are ordered by definition and
 * so must show their order in the colour rather than in the legend alone.
 * Monotone lightness, every adjacent gap >= 0.06 L, and the darkest step still
 * clears 2:1 against the panel (2.25:1) so stage five is a mark and not a hole.
 */
export const ORDINAL = ["#edb333", "#cf9812", "#af8008", "#906801", "#745300"] as const;

/**
 * State, never themed and never reused as "series 7". Each clears 3:1 on both
 * the panel and the plane, and each ships with a word beside it — a colour
 * alone never carries the meaning.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Ink. Cream carries the data; amber is the brand and stays on headings and hero figures. */
export const INK = {
  primary: "#f6ecd8",
  secondary: "#c9bfa6",
  muted: "#93a684",
  brand: "#f8a81b",
  grid: "rgba(246, 236, 216, 0.08)",
  axis: "rgba(246, 236, 216, 0.18)",
  hairline: "rgba(248, 168, 27, 0.16)",
} as const;

/**
 * Provenance is not a set of names, it is a confidence scale — ATTESTED is
 * stronger evidence than RECONSTRUCTED, which is stronger than INFERRED — so it
 * takes an ordinal ramp and the reader sees the ordering without reading the
 * legend. MODERN_DISH sits outside that scale entirely: it is not weaker
 * evidence for an ancient original, it is the claim that there is not one. It
 * gets a hue of its own for exactly that reason.
 */
export const PROVENANCE: Record<string, string> = {
  ATTESTED: ORDINAL[0],
  RECONSTRUCTED: ORDINAL[2],
  // Step 3, not the ramp's last step: step 4 clears the 2:1 ordinal floor but
  // sits at 2.25:1, and a 10px legend swatch at that contrast is a hole in the
  // page rather than a colour. Step 3 is 3.15:1 and still visibly the darkest.
  INFERRED: ORDINAL[3],
  MODERN_DISH: SERIES[3],
};

export const PROVENANCE_ORDER = ["ATTESTED", "RECONSTRUCTED", "INFERRED", "MODERN_DISH"] as const;

/**
 * What a turn was.
 *
 * The slots are assigned in the order the stacked bar paints them — see
 * `KIND_ORDER` in `tabs/Product.tsx` — and not by which hue felt apt for which
 * outcome. That is the whole point of a fixed slot order: the palette was
 * validated on its *adjacent* pairs, so the only way to inherit that guarantee
 * is for painted neighbours to be palette neighbours.
 *
 * An earlier version assigned these by feel and put terracotta beside rose,
 * which measures ΔE 10.4 under normal vision — below the floor of 15, and so
 * a pair a full-colour reader would struggle to separate. The validator caught
 * it; nobody would have caught it by eye, which is the argument for running it.
 */
export const KIND_COLOUR: Record<string, string> = {
  record: SERIES[0],
  modern: SERIES[1],
  foreign: SERIES[2],
  conversation: SERIES[3],
  gap: SERIES[4],
};

export const KIND_LABEL: Record<string, string> = {
  record: "Restored from a record",
  modern: "Genuinely modern",
  foreign: "Not Indian — Indianised",
  gap: "Corpus gap",
  conversation: "Follow-up talk",
};
