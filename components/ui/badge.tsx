import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary border-primary/30",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
        warn: "bg-amber-400/15 text-amber-300 border-amber-300/25",
        outline: "bg-transparent text-foreground border-border"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
