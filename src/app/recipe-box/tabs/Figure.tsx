import type { MaybeDelta } from "@/lib/dash/types";

import { Panel, StatTile } from "../../kitchen/ui/Panel";

/**
 * A headline that can have no value. A rate with nobody to divide by, or a
 * median of nothing, is not zero, and a tile reading "0%" would say it was —
 * so it renders as a panel that says why there is no figure.
 */
export function Figure({
  label,
  value,
  suffix,
  invert = false,
  comparable,
  empty,
  span = 4,
}: {
  label: string;
  value: MaybeDelta;
  suffix?: string;
  invert?: boolean;
  comparable: boolean;
  empty: string;
  span?: 3 | 4;
}) {
  if (value.now === null) {
    return (
      <Panel title={label} span={span}>
        <p className="k-empty">{empty}</p>
      </Panel>
    );
  }
  return (
    <StatTile
      label={label}
      delta={{ now: value.now, before: value.before ?? 0 }}
      suffix={suffix}
      invert={invert}
      comparable={comparable}
      span={span}
    />
  );
}
