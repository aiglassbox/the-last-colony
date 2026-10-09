"use client";

import { useState } from "react";

import type { Preview } from "@/lib/mailroom/send";

/**
 * The filled email as it will arrive, and who it will reach.
 *
 * The frame's empty `sandbox` is the seal: no scripts, no same-origin access
 * to this page or its cookie, while images still load. The HTML has been
 * through `fillTemplate`, so this is belt and braces, but the page it sits in
 * can send email, so it gets both.
 */

const WIDTHS = [640, 375] as const;

function recipientsLine(r: NonNullable<Preview["recipients"]>): string {
  const parts = [
    `${r.valid} ${r.valid === 1 ? "address" : "addresses"}`,
    `${r.optedOut} opted out (skipped)`,
    `${r.send} will send today`,
    `${r.waiting} ${r.waiting === 1 ? "waits" : "wait"} for tomorrow`,
  ];
  if (r.invalid.length > 0) parts.push(`could not read: ${r.invalid.join(", ")}`);
  return parts.join(" · ");
}

export function PreviewPane({ preview }: { preview: Preview }) {
  const [width, setWidth] = useState<(typeof WIDTHS)[number]>(640);

  return (
    <div className="mr-preview">
      <p className="mr-meta">
        {preview.recipients ? recipientsLine(preview.recipients) : `To: ${preview.to ?? ""}`}
      </p>
      <p className="mr-meta">
        <span className="mr-meta__key">Subject</span> {preview.subject}
      </p>

      {preview.warnings.map((warning) => (
        <p key={warning} className="mr-warn">
          {warning}
        </p>
      ))}

      <div className="mr-seg" role="group" aria-labelledby="mr-width-label">
        <span id="mr-width-label">Width</span>
        <span className="mr-seg__opts">
          {WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w} px
            </button>
          ))}
        </span>
      </div>

      <div className="mr-stage">
        <iframe sandbox="" srcDoc={preview.html} title="Email preview" className="mr-frame" style={{ width }} />
      </div>
    </div>
  );
}
