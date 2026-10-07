import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 relative overflow-hidden group",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        // dark:text overrides --destructive-foreground specifically in dark mode: five
        // of the six dark themes pair a pale destructive background (60% lightness)
        // with white text (~3.78:1, below WCAG AA's 4.5:1) — near-black text against
        // the same background clears AA (~4.96:1) without needing a per-theme CSS edit,
        // since @custom-variant dark (&:is(.dark *)) only fires when applyMode() has
        // already added .dark (src/lib/appearance.ts), never in light mode.
        destructive: "bg-destructive text-destructive-foreground dark:text-[hsl(0_0%_7%)] hover:bg-destructive/90 active:bg-destructive/80",
        outline: "border border-border bg-background hover:bg-muted active:bg-muted/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
        ghost: "hover:bg-muted hover:text-foreground active:bg-muted/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2 md:h-10",
        sm: "h-10 px-4 md:h-9 text-xs",
        lg: "h-12 px-8 md:h-11 text-base",
        icon: "h-11 w-11 md:h-10 md:w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
