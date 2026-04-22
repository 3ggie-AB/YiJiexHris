import React from "react";

import { cn } from "../../lib/utils";

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "default" | "sm" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(102,214,255,0.95),rgba(132,246,255,0.78))] text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.35)] hover:brightness-105",
  secondary:
    "border border-white/10 bg-white/[0.06] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-white/20 hover:bg-white/[0.1]",
  outline:
    "border border-white/12 bg-slate-950/20 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-cyan-300/30 hover:bg-cyan-400/10",
  ghost: "border border-transparent bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white",
  destructive:
    "border border-rose-300/20 bg-[linear-gradient(135deg,rgba(255,88,123,0.22),rgba(127,29,29,0.22))] text-rose-100 hover:border-rose-300/35 hover:bg-[linear-gradient(135deg,rgba(255,88,123,0.32),rgba(127,29,29,0.28))]",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-xs uppercase tracking-[0.24em]",
  lg: "h-12 px-6 text-sm uppercase tracking-[0.2em]",
};

export function buttonVariants(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  const variant = options?.variant ?? "default";
  const size = options?.size ?? "default";

  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    options?.className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return <button type={type ?? "button"} className={buttonVariants({ variant, size, className })} {...props} />;
}
