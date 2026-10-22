"use client";

// The questions screen (step 2b, status SCREENING_IN_PROGRESS).
//
// Contract behaviors implemented here:
// - The attempt comes from POST /screening/current; the server's
//   secondsRemaining is the only trusted clock. The visible countdown is
//   display-only between re-syncs, which happen on load, on tab focus and
//   every minute.
// - Answers save as the user picks them (small debounced batches), with an
//   automatic retry queue on failure. Pending picks live in memory only —
//   nothing touches web storage.
// - If the server says the attempt can no longer be answered (409 "expired"
//   past grace, or 404 after the expiry sweep closed it, or the confirmed
//   zero on the server clock), the screen takes the RESULT path through the
//   safe-to-repeat POST /screening/submit — never an error page.
// - Confirm-before-submit reports unanswered questions (they score zero),
//   flushes the save queue first, then calls POST /screening/submit once;
//   repeats return the same stored result.
// - Correct answers are never fetched or shown — the server never sends
//   them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import { useJourney } from "@/components/journey-provider";
import { Button } from "@promptpaid/ui/components/button";
import { ErrorRetry } from "@/components/error-retry";
import type { ScreeningSection } from "@promptpaid/shared";

interface PublicQuestion {
  id: string;
  position: number;
  section: ScreeningSection;
  prompt: string;
  options: string[];
  answer: { chosenDisplayedIndex: number; answeredAt: string } | null;
}

interface PublicAttempt {
  id: string;
  attemptNumber: number;
  secondsRemaining: number;
  questions: PublicQuestion[];
}

type LoadState = "loading" | "ready" | "error";

const SECTION_NAMES: Record<ScreeningSection, string> = {
  LANGUAGE: "Language",
  READING: "Reading",
  CHAT: "Chat",
  JUDGMENT: "Judgment",
};

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SAVE_DEBOUNCE_MS = 600;
const BACKOFF_START_MS = 600;
const BACKOFF_MAX_MS = 15_000;

export function ScreeningTest() {
  const journey = useJourney();
  const router = useRouter();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [sections, setSections] = useState<
    { key: ScreeningSection; questions: PublicQuestion[] }[]
  >([]);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [activeSection, setActiveSection] = useState(0);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saved");
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState<{ notice: string; waiting: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null); // save/submit blocker message
  const [suspended, setSuspended] = useState(false);

  // --- Engine refs: the small state machine for save / end / submit. -----
  const pendingRef = useRef(new Map<string, number>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const submitStartedRef = useRef(false);
  const backoffRef = useRef(BACKOFF_START_MS);
  const endedRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const resyncInFlightRef = useRef(false);
  /** Set once the display countdown hit zero; reset when the server says >0. */
  const zeroConfirmRef = useRef(false);

  const flushNowRef = useRef<(() => Promise<void>) | null>(null);
  const submitRef = useRef<((notice: string | null) => Promise<void>) | null>(null);
  const endAttemptRef = useRef<((notice: string) => void) | null>(null);

  const applySeconds = useCallback((serverSeconds: number) => {
    setSeconds(serverSeconds);
    if (serverSeconds > 0) zeroConfirmRef.current = false;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (endedRef.current || flushingRef.current || flushTimerRef.current) return;
    if (pendingRef.current.size === 0) return;
    flushTimerRef.current = setTimeout(() => void flushNowRef.current?.(), SAVE_DEBOUNCE_MS);
  }, []);

  // One debounced batch per pause in picking. Failures re-queue and retry
  // with a growing backoff; valid stops (expired/closed) hand over to the
  // result path via endAttemptRef.
  flushNowRef.current = async () => {
    if (endedRef.current || flushingRef.current || pendingRef.current.size === 0) return;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const batch = [...pendingRef.current];
    pendingRef.current.clear();
    flushingRef.current = true;
    setSaveState("saving");

    let scheduleRetry = false;
    try {
      const res = await api<{ saved: number; secondsRemaining: number }>("/screening/answers", {
        method: "POST",
        body: {
          answers: batch.map(([attemptQuestionId, chosenDisplayedIndex]) => ({
            attemptQuestionId,
            chosenDisplayedIndex,
          })),
        },
      });
      backoffRef.current = BACKOFF_START_MS;
      applySeconds(res.secondsRemaining);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "wrong_status" && error.code === "expired") {
          // Past deadline + grace: the answer path is closed for good; the
          // result path takes over.
          endAttemptRef.current?.(error.message);
          return;
        }
        if (error.kind === "not_found" || (error.kind === "wrong_status" && error.code !== "expired")) {
          // Attempt closed or journey moved elsewhere. Not an error — end
          // through the safe repeat submit (or a journey recovery).
          endAttemptRef.current?.(
            error.kind === "not_found" ? error.message : "Your test has ended.",
          );
          return;
        }
        if (error.kind === "fields") {
          // The server rejected this batch as unsavable (question or option
          // outside this attempt). Retrying cannot succeed; show it and
          // drop the batch.
          setMsg(error.message);
          return;
        }
      }
      // Offline / 5xx / 429: queue the picks again and retry later.
      for (const [id, index] of batch) {
        if (!pendingRef.current.has(id)) pendingRef.current.set(id, index);
      }
      backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
      scheduleRetry = true;
      setSaveState("error");
    } finally {
      flushingRef.current = false;
      if (!endedRef.current) {
        if (pendingRef.current.size > 0) {
          setSaveState("saving");
          if (scheduleRetry) {
            flushTimerRef.current = setTimeout(() => void flushNowRef.current?.(), backoffRef.current);
          } else {
            scheduleFlush();
          }
        } else if (!scheduleRetry) {
          setSaveState((prev) => (prev === "error" ? prev : "saved"));
        }
      }
    }
  };

  // The end-of-attempt path: stop answering, then submit (which is safe to
  // repeat and returns either the fresh grade or the stored result).
  endAttemptRef.current = (notice) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setSaveState("saved");
    setConfirming(false);
    setEnding({ notice, waiting: true });
    void submitRef.current?.(notice);
  };

  submitRef.current = async (notice) => {
    if (submitStartedRef.current) return;
    submitStartedRef.current = true;
    setMsg(null);
    try {
      // Deliver anything still queued before grading, so nothing silently
      // fails to count. A stuck queue blocks the submit with a clear
      // message instead of proceeding over lost answers.
      if (pendingRef.current.size > 0) {
        await flushNowRef.current?.();
        if (pendingRef.current.size > 0) {
          setEnding((prev) => (prev ? { ...prev, waiting: false } : prev));
          setMsg("Your latest answers could not reach the server. Check your data and try again.");
          return;
        }
      }
      const res = await api<{ result: { passed: boolean; suspended: boolean } }>(
        "/screening/submit",
        { method: "POST", body: {} },
      );
      if (res.result.suspended) {
        // Third failed attempt: the server cleared the session cookie.
        // Show the outcome inline; no navigation, no further requests.
        setEnding(null);
        setSuspended(true);
        return;
      }
      // Passing (SCREENING_PASSED) and failing (PROFILE_COMPLETE) both
      // allow the result screen. Re-read the journey first so the gate
      // sees the fresh status, then navigate; the result screen fetches
      // and displays the stored result itself.
      await journey.loadStatus(true);
      router.replace(ROUTES.screeningResult);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "wrong_status" || error.kind === "not_found") {
          await journey.recoverToJourney();
          return;
        }
        setMsg(error.message);
      } else {
        setMsg("No connection. Check your data and try again.");
      }
      setEnding((prev) => (prev ? { ...prev, waiting: false } : prev));
    } finally {
      submitStartedRef.current = false;
    }
  };

  const enqueueAnswer = useCallback((questionId: string, chosenDisplayedIndex: number) => {
    if (endedRef.current) return;
    pendingRef.current.set(questionId, chosenDisplayedIndex);
    setSelections((prev) => ({ ...prev, [questionId]: chosenDisplayedIndex }));
    setSaveState("saving");
    scheduleFlush();
  }, [scheduleFlush]);

  // -----------------------------------------------------------------------
  // Load and re-sync.
  // -----------------------------------------------------------------------
  const resyncRef = useRef<(() => Promise<void>) | null>(null);

  const adoptAttempt = useCallback(
    (attempt: PublicAttempt) => {
      attemptIdRef.current = attempt.id;
      setAttemptNumber(attempt.attemptNumber);

      // The server returns questions grouped by section, positions
      // ascending; keep exactly that order and grouping.
      const grouped: { key: ScreeningSection; questions: PublicQuestion[] }[] = [];
      for (const question of attempt.questions) {
        const last = grouped[grouped.length - 1];
        if (last && last.key === question.section) last.questions.push(question);
        else grouped.push({ key: question.section, questions: [question] });
      }
      setSections(grouped);
      setActiveSection((prev) => Math.min(prev, grouped.length - 1));

      const savedPicks: Record<string, number> = {};
      for (const question of attempt.questions) {
        if (question.answer) savedPicks[question.id] = question.answer.chosenDisplayedIndex;
      }
      // Optimistic local picks (not yet confirmed by a save response) win;
      // the server's saved picks fill everything else.
      setSelections((prev) => {
        const merged = { ...savedPicks };
        for (const [id, index] of pendingRef.current) merged[id] = index;
        return merged;
      });

      applySeconds(attempt.secondsRemaining);
    },
    [applySeconds],
  );

  const resync = useCallback(async () => {
    if (endedRef.current || resyncInFlightRef.current) return;
    if (attemptIdRef.current === null) return; // the initial load reads itself
    resyncInFlightRef.current = true;
    try {
      const res = await api<{ attempt: PublicAttempt }>("/screening/current", {
        method: "POST",
        body: {},
      });
      if (endedRef.current || attemptIdRef.current !== res.attempt.id) return;
      applySeconds(res.attempt.secondsRemaining);
      if (res.attempt.secondsRemaining === 0 && !zeroConfirmRef.current) {
        zeroConfirmRef.current = true;
        // The server also reads zero. Whether grading happens now (inside
        // the grace window) or as expired, the submit path ends the test.
        endAttemptRef.current?.("Time is up. Wrapping up your attempt…");
      }
    } catch {
      // Transient: the next minute tick, a tab focus, or the explicit
      // zero-check retries. Never block the user over a failed re-sync.
    } finally {
      resyncInFlightRef.current = false;
    }
  }, [applySeconds]);
  resyncRef.current = resync;

  const loadAttempt = useCallback(async () => {
    setLoadState("loading");
    setMsg(null);
    try {
      const res = await api<{ attempt: PublicAttempt }>("/screening/current", {
        method: "POST",
        body: {},
      });
      adoptAttempt(res.attempt);
      setLoadState("ready");
      if (res.attempt.secondsRemaining === 0) {
        zeroConfirmRef.current = true;
        endAttemptRef.current?.("Time is up. Wrapping up your attempt…");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "not_found") {
          // No open attempt — e.g. the expiry sweep closed it while the tab
          // was away. Show the result, never an error page.
          endedRef.current = true;
          endAttemptRef.current?.(error.message);
          return;
        }
        if (error.kind === "wrong_status") {
          await journey.recoverToJourney();
          return;
        }
        setLoadState("error");
        setLoadError(error.message);
        return;
      }
      setLoadState("error");
      setLoadError("No connection. Check your data and try again.");
    }
  }, [adoptAttempt, journey]);

  // Countdown ticks (display-only), the re-sync triggers (tab focus, every
  // minute), and the one-shot confirm when the display countdown hits zero.
  useEffect(() => {
    if (loadState !== "ready") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    const minuteTimer = setInterval(() => void resync(), 60_000);
    const tick = setInterval(() => {
      setSeconds((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(minuteTimer);
      clearInterval(tick);
    };
  }, [loadState, resync]);

  useEffect(() => {
    if (loadState !== "ready" || seconds !== 0) return;
    if (endedRef.current || zeroConfirmRef.current) return;
    zeroConfirmRef.current = true;
    void resync();
  }, [seconds, loadState, resync]);

  // -----------------------------------------------------------------------
  // Derived view facts.
  // -----------------------------------------------------------------------
  const totalQuestions = useMemo(
    () => sections.reduce((sum, s) => sum + s.questions.length, 0),
    [sections],
  );
  const answeredCount = useMemo(() => Object.keys(selections).length, [selections]);
  const unansweredTotal = totalQuestions - answeredCount;
  const active = sections[activeSection];
  const timeCritical = seconds !== null && seconds <= 60;
  const ended = ending !== null;

  if (suspended) {
    return (
      <section className="clay p-5" role="alert">
        <h2 className="text-lg font-semibold">Your account is under review</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You didn&apos;t pass the screening test, and this was your third failed attempt, so
          your account is now reviewed before it can continue. You have been signed out.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          If you think this decision is wrong, contact support.
        </p>
        <Button
          className="mt-5 min-h-11 w-full text-sm"
          onClick={() => router.replace(ROUTES.login)}
        >
          Back to sign in
        </Button>
      </section>
    );
  }

  if (loadState === "loading") {
    return (
      <p className="clay p-5 text-sm text-muted-foreground" aria-live="polite">
        Loading your test…
      </p>
    );
  }

  if (loadState === "error" || !active) {
    return (
      <ErrorRetry
        title="The test could not load"
        message={loadError ?? "Something went wrong. Please try again."}
        onRetry={() => void loadAttempt()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Countdown: informational between re-syncs. No live region so the
          text is not re-read every second by screen readers. */}
      <section
        className={`clay-sm flex items-center justify-between p-4 ${
          timeCritical ? "text-destructive" : ""
        }`}
        aria-label="Time remaining"
      >
        <p className="text-sm text-muted-foreground">Attempt {attemptNumber}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{mmss(seconds ?? 0)}</p>
      </section>

      {/* Section switcher with per-section progress. */}
      <div className="flex flex-wrap gap-2">
        {sections.map((section, index) => {
          const answered = section.questions.filter((q) => selections[q.id] !== undefined).length;
          const isActive = index === activeSection;
          return (
            <button
              key={section.key}
              type="button"
              aria-pressed={isActive}
              disabled={ended}
              onClick={() => setActiveSection(index)}
              className={`clay-sm min-h-11 rounded-[0.9rem] px-3 text-sm ${
                isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {SECTION_NAMES[section.key]}{" "}
              <span className="tabular-nums">
                {answered}/{section.questions.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Save-state line: the visible face of the auto-save queue. */}
      <p className="min-h-5 text-xs" aria-live="polite">
        {saveState === "saving" ? (
          <span className="text-muted-foreground">Saving your answers…</span>
        ) : saveState === "error" ? (
          <span className="text-destructive">
            An answer is not saved yet — it will retry automatically.{" "}
            <button
              type="button"
              className="h-11 font-medium underline"
              onClick={() => void flushNowRef.current?.()}
            >
              Save now
            </button>
          </span>
        ) : (
          <span className="text-muted-foreground">All answers saved on the server.</span>
        )}
      </p>

      {/* One section at a time, in the order the server drew them. */}
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {SECTION_NAMES[active.key]} — {active.questions.length}{" "}
        {active.questions.length === 1 ? "question" : "questions"}
      </p>
      <div className="space-y-4">
        {active.questions.map((question, qIndex) => {
          const chosen = selections[question.id];
          return (
            <fieldset key={question.id} className="clay-field rounded-[1rem] p-4">
              <legend className="sr-only">
                {SECTION_NAMES[active.key]} question {qIndex + 1}
              </legend>
              <p className="text-sm font-medium">
                <span className="mr-1.5 tabular-nums text-muted-foreground">{qIndex + 1}.</span>
                {question.prompt}
              </p>
              <div className="mt-3 space-y-2">
                {question.options.map((option, index) => (
                  <label
                    key={index}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[0.9rem] border p-3 text-sm ${
                      chosen === index
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      value={index}
                      checked={chosen === index}
                      disabled={ended}
                      onChange={() => enqueueAnswer(question.id, index)}
                      className="size-4 shrink-0 accent-foreground"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 flex-1 text-sm"
          disabled={activeSection === 0 || ended}
          onClick={() => setActiveSection((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        {activeSection < sections.length - 1 ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1 text-sm"
            disabled={ended}
            onClick={() => setActiveSection((i) => i + 1)}
          >
            Next section
          </Button>
        ) : null}
      </div>

      {/* Confirm before submit. */}
      {confirming ? (
        <section
          className="clay p-5"
          role="alertdialog"
          aria-label="Confirm submit"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirming(false);
          }}
        >
          <h2 className="text-base font-semibold">Submit your test?</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {answeredCount} of {totalQuestions} answered.
            {unansweredTotal > 0
              ? ` ${unansweredTotal} unanswered ${
                  unansweredTotal === 1 ? "question scores" : "questions score"
                } zero.`
              : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You cannot change answers after submitting.
          </p>
          <div className="mt-4 space-y-2">
            <Button
              className="min-h-11 w-full text-sm"
              onClick={() => {
                setConfirming(false);
                void submitRef.current?.(null);
              }}
            >
              Submit now
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full text-sm"
              onClick={() => setConfirming(false)}
            >
              Keep answering
            </Button>
          </div>
        </section>
      ) : (
        <Button
          type="button"
          className="min-h-11 w-full text-sm"
          disabled={ended}
          onClick={() => setConfirming(true)}
        >
          Submit test
        </Button>
      )}

      {/* End-of-attempt banner (expired or closed elsewhere). We came here
          through submit, so only the blocker message can still surface. */}
      {ended ? (
        <section className="clay p-5" aria-live="assertive">
          <p className="text-sm font-medium">{ending?.notice}</p>
          {ending?.waiting ? (
            <p className="mt-1 text-sm text-muted-foreground">Preparing your result…</p>
          ) : msg ? (
            <>
              <p className="mt-1 text-sm text-destructive">{msg}</p>
              <Button
                className="mt-3 min-h-11 w-full text-sm"
                onClick={() => void submitRef.current?.(ending?.notice ?? null)}
              >
                See my result
              </Button>
            </>
          ) : null}
        </section>
      ) : null}

      {msg && !ended ? (
        <p role="alert" className="clay-sm rounded-[1rem] p-3 text-sm text-destructive">
          {msg}
        </p>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Your test runs on the server. Leaving this page does not pause it.
      </p>
    </div>
  );
}
