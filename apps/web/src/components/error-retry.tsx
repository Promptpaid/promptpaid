// Shared retryable-error surface. Never carries raw server errors or stack
// traces — only the friendly message produced by the API error mapping.
// Retry keeps whatever the caller still holds in state; this component
// never clears anything.

"use client";

import { Button } from "@promptpaid/ui/components/button";
import type { ReactNode } from "react";

export function ErrorRetry({
  title = "Something went wrong",
  message,
  onRetry,
  retrying = false,
  actionLabel = "Try again",
}: {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  actionLabel?: string;
}) {
  return (
    <div className="clay p-5" role="alert" aria-live="polite">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button
          className="mt-4 min-h-11 w-full text-sm"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? "Retrying…" : actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
