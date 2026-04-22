import React from "react";

import { cn } from "../../lib/utils";

export function Input({ className, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-white/[0.06] focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
