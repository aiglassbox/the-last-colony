/**
 * Brand marks.
 *
 * The supplied logo files are white silhouettes on transparency, drawn for the
 * maroon comp. Rather than ship a second red copy of each, they are painted as
 * CSS masks — the shape comes from the PNG, the colour from a token. One asset
 * then works in both themes and follows the palette if it ever moves.
 */

interface MarkProps {
  /** Rendered height in px; width follows the asset's aspect ratio. */
  size?: number;
  className?: string;
}

function Mask({
  src,
  ratio,
  size,
  label,
  className,
}: MarkProps & { src: string; ratio: number; label: string; size: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={className}
      style={{
        display: "inline-block",
        width: size * ratio,
        height: size,
        flex: "0 0 auto",
        background: "currentColor",
        WebkitMask: `url("${src}") center / contain no-repeat`,
        mask: `url("${src}") center / contain no-repeat`,
      }}
    />
  );
}

/** The Asli Rasoi seal. 168 × 156 in the supplied file. */
export function Logo({ size = 34, className }: MarkProps) {
  return (
    <Mask
      src="/brand/asli-rasoi.png"
      ratio={168 / 156}
      size={size}
      label="Asli Rasoi"
      className={className}
    />
  );
}

/** "A brand from gokul agro resources ltd" — top right. 641 × 135. */
export function GokulMark({ size = 30, className }: MarkProps) {
  return (
    <Mask
      src="/brand/gokul.png"
      ratio={641 / 135}
      size={size}
      label="A brand from Gokul Agro Resources Ltd"
      className={className}
    />
  );
}

/** The Vitalife wordmark — bottom right, above Shop Now. 569 × 254. */
export function VitalifeMark({ size = 44, className }: MarkProps) {
  return (
    <Mask
      src="/brand/vitalife.png"
      ratio={569 / 254}
      size={size}
      label="Vitalife"
      className={className}
    />
  );
}
