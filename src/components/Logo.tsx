/**
 * Brand marks.
 *
 * The Kranti Cookbook lockup is supplied as flat green ink, so it is reduced
 * to an alpha mask and painted with `currentColor`. That is what lets the one
 * file sit green on the amber rail and cream on the painted ground, without
 * shipping two artworks that could drift apart — and why a new drop of the
 * lockup needs only the mask replaced, never a colour decided.
 *
 * The Gokul endorsement keeps its own colour, so it stays a real image.
 */

interface MarkProps {
  /** Rendered height in px; width follows the asset's aspect ratio. */
  size?: number;
  className?: string;
}

/** "The Kranti Cookbook" — 723 × 598 after keying and cropping to the ink. */
export function Logo({ size = 46, className }: MarkProps) {
  return (
    <span
      role="img"
      aria-label="The Kranti Cookbook"
      className={className}
      style={{
        display: "inline-block",
        // `size` is only the fallback. A stylesheet sizes the mark responsively
        // by setting --mark-h on an ANCESTOR — declaring it inline here would
        // put it on this same element, where it outranks the stylesheet.
        height: `var(--mark-h, ${size}px)`,
        aspectRatio: String(723 / 598),
        flex: "0 0 auto",
        background: "currentColor",
        WebkitMask: 'url("/brand/kranti.png") center / contain no-repeat',
        mask: 'url("/brand/kranti.png") center / contain no-repeat',
      }}
    />
  );
}

/**
 * "Two Brothers India Farms" — 1142 × 506 after cropping.
 *
 * The supplied file was 2813 × 2250 with the wordmark floating in a frame
 * roughly twice its height, which would have rendered it small inside whatever
 * box it was given. It is cropped to the ink and reduced to an alpha mask, so
 * like the Kranti lockup it paints in `currentColor` rather than shipping its
 * own beige — one less colour to keep in step with the palette.
 */
export function TwoBrothersMark({ size = 44, className }: MarkProps) {
  return (
    <span
      role="img"
      aria-label="Two Brothers India Farms"
      className={className}
      style={{
        display: "inline-block",
        height: `var(--mark-h, ${size}px)`,
        aspectRatio: String(1142 / 506),
        flex: "0 0 auto",
        background: "currentColor",
        WebkitMask: 'url("/brand/two-brothers.png") center / contain no-repeat',
        mask: 'url("/brand/two-brothers.png") center / contain no-repeat',
      }}
    />
  );
}

/** "A brand from gokul agro resources ltd" — 813 × 171, full colour. */
export function GokulMark({ size = 22, className }: MarkProps) {
  return (
    <span
      role="img"
      aria-label="A brand from Gokul Agro Resources Ltd"
      className={className}
      style={{
        display: "inline-block",
        height: `var(--mark-h, ${size}px)`,
        aspectRatio: String(813 / 171),
        flex: "0 0 auto",
        background: 'url("/brand/gokul.png") center / contain no-repeat',
      }}
    />
  );
}

/** The Vitalife wordmark alone — 564 × 188 after the endorsement line is cropped. */
export function VitalifeMark({ size = 26, className }: MarkProps) {
  return (
    <span
      role="img"
      aria-label="Vitalife"
      className={className}
      style={{
        display: "inline-block",
        height: `var(--mark-h, ${size}px)`,
        aspectRatio: String(564 / 188),
        flex: "0 0 auto",
        background: "currentColor",
        WebkitMask: 'url("/brand/vitalife.png") center / contain no-repeat',
        mask: 'url("/brand/vitalife.png") center / contain no-repeat',
      }}
    />
  );
}
