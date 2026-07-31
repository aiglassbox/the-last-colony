/**
 * The brand mark — an interlaced quatrefoil knot in the brand orange.
 * Decorative beside the wordmark, so it is hidden from assistive tech; the
 * adjacent text carries the name.
 */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="tlc-mark" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF6A00" />
          <stop offset="1" stopColor="#FF9D55" />
        </linearGradient>
      </defs>
      <path
        d="M20 3.6c3.9 0 7.1 3.2 7.1 7.1 0 .8-.1 1.5-.4 2.2.7-.2 1.4-.4 2.2-.4 3.9 0 7.1 3.2 7.1 7.1s-3.2 7.1-7.1 7.1c-.8 0-1.5-.1-2.2-.4.2.7.4 1.4.4 2.2 0 3.9-3.2 7.1-7.1 7.1s-7.1-3.2-7.1-7.1c0-.8.1-1.5.4-2.2-.7.2-1.4.4-2.2.4-3.9 0-7.1-3.2-7.1-7.1s3.2-7.1 7.1-7.1c.8 0 1.5.1 2.2.4-.3-.7-.4-1.4-.4-2.2 0-3.9 3.2-7.1 7.1-7.1Z"
        stroke="url(#tlc-mark)"
        strokeWidth="4.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
