import React from "react";

import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger";

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-cyan-300/18 bg-cyan-300/12 text-cyan-100",
  secondary: "border-white/10 bg-white/[0.06] text-slate-200",
  outline: "border-white/12 bg-transparent text-slate-300",
  success: "border-emerald-300/18 bg-emerald-300/12 text-emerald-100",
  warning: "border-amber-300/18 bg-amber-300/12 text-amber-100",
  danger: "border-rose-300/18 bg-rose-300/12 text-rose-100",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
