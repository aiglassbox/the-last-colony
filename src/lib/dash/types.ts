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
  email: EmailPanel;
}
