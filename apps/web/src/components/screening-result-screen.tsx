"use client";

// The result screen (step 2c). TWO positions legitimately arrive here:
// SCREENING_PASSED (straight after passing) and PROFILE_COMPLETE (after a
// failed or expired attempt). It reads the stored result via the safe,
// repeatable POST /screening/result and shows section scores, pass or
// fail, and the retake date the server set. It never shows correct
// answers — the server does not send them.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useJourney } from "@/components/journey-provider";
import { ErrorRetry } from "@/components/error-retry";
import {
  ScreeningResult,
  type ScreeningResultData,
} from "@/components/screening-result-view";

export function ScreeningResultScreen() {
  const journey = useJourney();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noResult, setNoResult] = useState(false);
  const [result, setResult] = useState<ScreeningResultData | null>(null);

  const read = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoResult(false);
    try {
      const res = await api<{ result: ScreeningResultData }>("/screening/result", {
        method: "POST",
        body: {},
      });
      setResult(res.result);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.kind === "not_found") {
          // No result stored yet (e.g. the URL was opened without a closed
          // attempt). Honest hint, button back into the journey.
          setNoResult(true);
          return;
        }
        if (err.kind === "wrong_status") {
          await journey.recoverToJourney();
          return;
        }
        setError(err.message);
        return;
      }
      setError("No connection. Check your data and try again.");
    } finally {
      setLoading(false);
    }
  }, [journey]);

  useEffect(() => {
    void read();
  }, [read]);

  if (loading) {
    return (
      <p className="clay p-5 text-sm text-muted-foreground" aria-live="polite">
        Loading your result…
      </p>
    );
  }

  if (noResult) {
    return (
      <div className="space-y-4">
        <div className="clay p-5" role="status">
          <h2 className="text-base font-semibold">No result yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            There is no screening result on your account yet. If you have not taken the test,
            start from the test screen.
          </p>
        </div>
        {journey.journeyState === "ready" ? (
          <button
            type="button"
            className="clay-press w-full rounded-[1rem] p-4 text-left text-sm font-medium"
            onClick={() => void journey.recoverToJourney()}
          >
            Go to my next step
          </button>
        ) : null}
      </div>
    );
  }

  if (error || !result) {
    return (
      <ErrorRetry
        title="The result could not load"
        message={error ?? "Something went wrong. Please try again."}
        onRetry={() => void read()}
      />
    );
  }

  return <ScreeningResult result={result} variant="page" />;
}
