// Shared loading indicator. Visible, honest, cheap: one icon, one line of
// text, no skeletons until F3+ where field shapes are known.

import { Loader2Icon } from "lucide-react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-40 flex-1 items-center justify-center"
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}
