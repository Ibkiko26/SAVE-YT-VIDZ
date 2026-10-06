import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "icon";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/80 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "bg-gradient-to-r from-pink via-purple to-blue text-white shadow-glow hover:-translate-y-0.5 hover:shadow-glow-strong",
        variant === "secondary" &&
          "border border-line bg-surface/70 text-foreground hover:border-pink/40 hover:bg-surface",
        variant === "ghost" &&
          "text-muted hover:bg-surface/80 hover:text-foreground",
        size === "default" && "min-h-12 px-6 text-sm",
        size === "icon" && "h-11 w-11 p-0",
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
