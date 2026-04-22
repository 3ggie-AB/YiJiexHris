import React from "react";

import { cn } from "../../lib/utils";

type AlertVariant = "default" | "success" | "danger" | "warning";

const variantClasses: Record<AlertVariant, string> = {
  default: "border-white/10 bg-white/[0.05] text-slate-100",
  success: "border-emerald-300/18 bg-emerald-300/12 text-emerald-100",
  danger: "border-rose-300/18 bg-rose-300/12 text-rose-100",
  warning: "border-amber-300/18 bg-amber-300/12 text-amber-100",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

export function Alert({ className, variant = "default", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-3xl border px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("text-sm font-semibold uppercase tracking-[0.22em]", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-2 text-sm leading-6", className)} {...props} />;
}
