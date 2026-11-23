"use client";

import { forwardRef } from "react";
import { Spinner } from "@/features/ui/Spinner";

// Buttons (UI-03). The look comes from the existing .btn-* classes, so older
// pages and new components match. While busy the button keeps its width
// (the label stays, hidden) and says what it is doing to screen readers.
export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-quiet" | "ghost";
// v1.89.0 (D-421): the named sizes only: sm 32 (--control-h-sm), md 40
// (--control-h-md, the default), lg 48 (--control-h-lg); 44 on touch screens.
export type ButtonSize = "md" | "sm" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  "danger-quiet": "btn-danger-quiet", // v1.72.2 (D-394, QA visual G15)
  ghost: "btn-ghost",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `${VARIANT[variant]} ${size === "sm" ? "btn-compact" : size === "lg" ? "btn-lg" : ""} ${extra}`.trim();
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string; // e.g. "Approving…"
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading = false, loadingLabel = "Working…", icon, className = "", children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant, size, className)} relative`}
      {...rest}
    >
      <span className={`inline-flex items-center gap-2 whitespace-nowrap ${loading ? "invisible" : ""}`}>
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <Spinner />
          <span className={size === "sm" ? "sr-only" : "text-label"}>{loadingLabel}</span>
        </span>
      )}
    </button>
  );
});
