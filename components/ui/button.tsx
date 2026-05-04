"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-[0_8px_30px_-10px_rgba(139,108,246,0.7)] hover:from-violet-400 hover:to-violet-600 hover:-translate-y-px",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-border bg-transparent hover:bg-secondary/40 hover:text-foreground",
        ghost: "hover:bg-secondary/40 hover:text-foreground",
        destructive:
          "bg-destructive/15 text-destructive hover:bg-destructive/25 border border-destructive/30",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6 text-sm",
        icon: "size-9"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
