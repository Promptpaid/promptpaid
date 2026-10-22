// Tappable chip in the site's "clay" idiom: a real checkbox underneath
// (keyboard + screen-reader friendly) with a big touch target.

"use client";

import { cn } from "@promptpaid/ui/lib/utils";
import type { ReactNode } from "react";

export function ChipToggle({
  selected,
  onToggle,
  children,
  disabled = false,
}: {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "clay-sm clay-press inline-flex min-h-11 cursor-pointer select-none items-center px-4 text-sm",
        selected && "bg-primary text-primary-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
      />
      {children}
    </label>
  );
}
