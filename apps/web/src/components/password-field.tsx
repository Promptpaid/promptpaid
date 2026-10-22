// Password input with a plain show/hide toggle. The toggle is a real
// button with a label (no icon-only mystery), 44px touch target, and it
// updates aria-label so screen readers follow along. Never leaves the
// value on screen by accident: type=text only while explicitly revealed.

"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@promptpaid/ui/components/input";

export function PasswordInput({
  id,
  autoComplete,
  value,
  onValueChange,
  ariaDescribedBy,
  invalid,
}: {
  id: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onValueChange: (next: string) => void;
  ariaDescribedBy?: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={id}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-describedby={ariaDescribedBy}
        aria-invalid={Boolean(invalid)}
        className="clay-field h-11 rounded-clay bg-background px-3.5 pr-12 text-sm"
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 inline-flex size-11 items-center justify-center rounded-clay text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        {shown ? <EyeOffIcon className="size-4" aria-hidden="true" /> : <EyeIcon className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
