/**
 * The shapes every panel reads.
 *
 * Kept apart from the queries that fill them so the chart components can be
 * typed against data without importing a database driver into the browser
 * bundle, and so a panel that is temporarily unavailable can be modelled as a
 * null field rather than as a thrown request.
 */

export interface Point {
  day: string;
  [series: string]: string | number;
}

export interface Counted {
  label: string;
  n: number;
}

/** A headline figure and the same figure over the preceding window. */
export interface Delta {
  now: number;
  before: number;
}

export interface UsageTotals {
  conversations: Delta;
  devices: Delta;
  messages: Delta;
  returningDevices: Delta;
  /** Devices that started a thread on two or more separate days. */
  multiDayDevices: Delta;
}

export interface DailyRow {
  day: string;
  threads: number;
  devices: number;
}

export interface NewReturningRow {
  day: string;
  fresh: number;
  returning: number;
}

export interface HeatCell {
  dow: number;
  hour: number;
  n: number;
}

export interface DepthRow {
  messages: number;
  threads: number;
}

export interface KindRow {
  kind: string;
  n: number;
}

export interface ProvenanceRow {
  provenance: string;
  n: number;
}

export interface SlugRow {
  slug: string;
  provenance: string;
  n: number;
}

export interface AskedRow {
  label: string;
  n: number;
  /** The raw spellings folded into this label, when more than one was seen. */
  variants: string[];
}

export interface CohortRow {
  cohort: string;
  size: number;
  /** Devices still active, indexed by days since the cohort day. */
  retained: number[];
}

export interface EventTotals {
  event: string;
  n: number;
  devices: number;
}

export interface AttributionRow {
  source: string;
  medium: string;
  campaign: string;
  visits: number;
  devices: number;
  /** Devices from this placement that went on to start a thread. */
  converted: number;
}

export interface FunnelStage {
  label: string;
  n: number;
  /** What this stage means, shown under the bar. Never a bare number. */
  note: string;
}

export interface GeoPanel {
  countries: Counted[];
  cities: Counted[];
  /** Devices whose edge-resolved zone is Asia/Kolkata, against those we know a zone for. */
  inIndia: number;
  located: number;
}

export interface EmailPanel {
  clicks: number;
  opens: number;
  uniqueClickers: number;
  uniqueOpeners: number;
  automated: number;
  suppressed: number;
  perCode: Counted[];
  daily: { day: string; clicks: number; opens: number }[];
}

export interface ThreadSummary {
  id: string;
  device: string;
  title: string;
  messages: number;
  createdAt: string;
  kinds: string[];
}

export interface Report {
  generatedAt: string;
  rangeLabel: string;
  /**
   * Whether there is a period before this one to compare against. False only
   * for all-time. A fact about the range, carried on the report, so no panel
   * has to infer it by matching `rangeLabel` against a display string — which
   * is a comparison that breaks silently the day somebody rewords a tab.
   */
  comparable: boolean;
  /** True when the events table exists and has rows in this window. */
  hasEvents: boolean;
  totals: UsageTotals;
  daily: DailyRow[];
  newReturning: NewReturningRow[];
  heat: HeatCell[];
  depth: DepthRow[];
  kinds: KindRow[];
  provenance: ProvenanceRow[];
  topSlugs: SlugRow[];
  asked: AskedRow[];
  gaps: AskedRow[];
  foreign: AskedRow[];
  commands: Counted[];
  errors: number;
  cohorts: CohortRow[];
  events: EventTotals[];
  attribution: AttributionRow[];
  funnel: FunnelStage[];
  geo: GeoPanel;
  email: EmailPanel;
}

/**
 * One group of `recipe_step` rows: a step, an outcome and a reason — or, with
 * `rollup`, the step's own total across all of them, so a device that hit two
 * outcomes is still one device at that step.
 */
export interface StepRow {
  step: string;
  outcome: string | null;
  reason: string | null;
  rollup: boolean;
  n: number;
  devices: number;
}

export interface CountedDevices {
  label: string;
  n: number;
  devices: number;
}

/** A headline that can have no value at all: a rate with no denominator, a median of nothing. */
export interface MaybeDelta {
  now: number | null;
  before: number | null;
}

export interface RecipeFunnelPanel {
  presses: Delta;
  pressDevices: Delta;
  opens: Delta;
  openDevices: Delta;
  /** Devices whose submit the server stored. */
  acceptedDevices: Delta;
  /** Open-to-accepted, whole percent of devices. */
  rate: MaybeDelta;
  /** Open-to-accepted time, minutes to one decimal. */
  medianMinutes: MaybeDelta;
  daily: { day: string; presses: number; opens: number }[];
  stages: FunnelStage[];
  photo: Counted[];
  refusals: Counted[];
  secondary: CountedDevices[];
  finish: Counted[];
}

export interface RecipeReport {
  generatedAt: string;
  rangeLabel: string;
  /** False only for all-time, as on the kitchen's report. */
  comparable: boolean;
  funnel: RecipeFunnelPanel;
}
