import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn-shaped Textarea. React 19 passes `ref` as a plain prop, so no
 * forwardRef wrapper is needed.
 */
export function Textarea({
  className,
  ref,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-[var(--line-strong)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
