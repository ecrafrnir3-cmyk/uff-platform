"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while its form's server action is pending,
 * preventing double-submits (e.g. a double-click creating two leagues).
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className,
  style,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
      style={{ ...style, ...(pending ? { opacity: 0.6, cursor: "not-allowed" } : null) }}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
