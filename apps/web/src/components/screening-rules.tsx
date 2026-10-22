"use client";

// Screening start screen (step 2). Shows the rules from @promptpaid/shared
// (time limit today, not hardcoded), the last failed attempt if there is
// one, and the Start button. Start is safe to repeat: the server returns
// the open attempt instead of creating a second one, so double taps are
// harmless.
//
// Outcomes handled:
// - 201/200 -> the journey refreshes and the status router sends the user
//   to the questions screen (SCREENING_IN_PROGRESS).
// - 403 cooldown -> shows the retake date the server sent (after a fail).
// - 409 wrong_status -> recoverToJourney() (position changed elsewhere).
// - 503 (question bank not loaded) / 5xx / offline -> friendly retry, the
//   button re-enables.

import { useCallback, useEffect, useState } from "react";
import {
  SCREENING_MAX_FAILURES_BEFORE_SUSPEND,
  SCREENING_PASS_PERCENT,
  SCREENING_RETAKE_AFTER_FIRST_FAIL_DAYS,
  SCREENING_RETAKE_AFTER_SECOND_FAIL_DAYS,
  SCREENING_TIME_LIMIT_SEC,
  enabledScreeningSections,
  SCREENING_SECTIONS,
  type ScreeningSection,
} from "@promptpaid/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@promptpaid/ui/components/button";
import { useJourney } from "@/components/journey-provider";
import { ScreeningResult, type ScreeningResultData } from "@/components/screening-result-view";

const sectionNames: Record<ScreeningSection, string> = {
  LANGUAGE: "Language",
  READING: "Reading",
  CHAT: "Chat",
  JUDGMENT: "Judgment",
};

function minutesLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** From shared settings — `points` is already the human number (25, 15, 20). */
const SECTION_POINTS_LINE = enabledScreeningSections()
  .map((section) => `${sectionNames[section]} ${SCREENING_SECTIONS[section].points}`)
  .join(", ");

export function ScreeningRules() {
  const journey = useJourney();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cooldownMessage, setCooldownMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScreeningResultData | null>(null);
  const [checkingHistory, setCheckingHistory] = useState(true);

  // The user reaches this screen at PROFILE_COMPLETE both first-time and
  // after a failed attempt. The stored result (readable at PROFILE_COMPLETE
  // per the action table) tells us which case we're in so the screen can be
  // honest either way. 404 (no result yet) is the normal first-time case.
  const readLastResult = useCallback(async () => {
    setCheckingHistory(true);
    try {
      const res = await api<{ result: ScreeningResultData }>("/screening/result", {
        method: "POST",
        body: {},
      });
      if (res.result && !res.result.passed) setLastResult(res.result);
      else setLastResult(null);
    } catch {
      setLastResult(null);
    } finally {
      setCheckingHistory(false);
    }
  }, []);

  useEffect(() => {
    void readLastResult();
  }, [readLastResult]);

  async function start() {
    if (starting) return;
    setStartError(null);
    setCooldownMessage(null);
    setStarting(true);
    try {
      await api<{ attempt: unknown }>("/screening/start", { method: "POST", body: {} });
      // Journey position is now SCREENING_IN_PROGRESS; route through the
      // status router to the questions screen.
      await journey.recoverToJourney();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "wrong_status") {
          await journey.recoverToJourney();
          return;
        }
        if (error.status === 403 && error.code === "cooldown") {
          // Body: { nextAttemptDate, failures }. Message already holds the
          // full sentence; keep the date visible verbatim.
          setCooldownMessage(error.message);
        } else {
          setStartError(error.message);
        }
      } else {
        setStartError("Starting failed. Check your connection and try again.");
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-5">
      {cooldownMessage ? (
        <div className="clay-sm p-4" role="status">
          <p className="text-sm font-medium">Your next attempt is on cooldown.</p>
          <p className="mt-1 text-sm text-muted-foreground">{cooldownMessage}</p>
        </div>
      ) : null}

      {lastResult && !cooldownMessage ? (
        <ScreeningResult result={lastResult} variant="last-attempt" />
      ) : null}

      <section className="clay p-5" aria-label="Test rules">
        <h2 className="text-sm font-semibold">How the test works</h2>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">{minutesLabel(SCREENING_TIME_LIMIT_SEC)}</span>,
            timed on our server — pausing or leaving the page doesn't stop it.
          </li>
          <li>
            Pass mark <span className="text-foreground">{SCREENING_PASS_PERCENT}%</span> of
            the available points ({SECTION_POINTS_LINE}).
          </li>
          <li>
            Answers save automatically as you choose them — a dropped network won't lose your
            progress.
          </li>
          <li>
            One retake after <span className="text-foreground">{SCREENING_RETAKE_AFTER_FIRST_FAIL_DAYS} days</span>{" "}
            if you don't pass; after a second fail,{" "}
            <span className="text-foreground">{SCREENING_RETAKE_AFTER_SECOND_FAIL_DAYS} days</span>. After{" "}
            <span className="text-foreground">{SCREENING_MAX_FAILURES_BEFORE_SUSPEND} failed attempts</span>{" "}
            the account is reviewed, so only start when you're ready.
          </li>
        </ul>
      </section>

      {startError ? (
        <div role="alert" className="clay-sm p-4 text-sm text-destructive">
          {startError}
        </div>
      ) : null}

      <Button
        className="min-h-11 w-full text-sm"
        disabled={starting}
        onClick={() => void start()}
      >
        {starting ? "Starting…" : lastResult ? "Try again" : "Start the test"}
      </Button>
      {checkingHistory ? (
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          Checking your test history…
        </p>
      ) : null}
    </div>
  );
}
