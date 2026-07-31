import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn-shaped Button.
 *
 * Same API as the upstream component — `variant`, `size`, `asChild` — but the
 * variants resolve to this product's tokens rather than shadcn's
 * `primary`/`secondary` theme. Pulling in the whole shadcn theme would leave
 * two competing colour systems in one stylesheet, and the palette here is
 * carrying an argument (THEN is warm, NOW is cool) rather than decorating.
 */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--orange)] text-[var(--surface)] hover:opacity-90",
        outline:
          "border border-[var(--line-strong)] bg-transparent text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--orange)]",
        ghost: "bg-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]",
        link: "text-[var(--orange)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
