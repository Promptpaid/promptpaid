"use client";

// Screening result display, shared by two screens:
// - /onboarding/screening/result (full page after submitting, or directly
//   after an expiry)
// - the start screen's "last attempt" card (failed attempts keep the user
//   at PROFILE_COMPLETE, so the rules screen shows what happened)
//
// Section scores come from the server as tenths; shared settings hold the
// section points, so the totals here never factor amounts in on their own.
// Never shows correct answers — the server never sends them.

import { Button } from "@promptpaid/ui/components/button";
import {
  SCREENING_PASS_PERCENT,
  SCREENING_SECTIONS,
  type ScreeningSection,
} from "@promptpaid/shared";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { useJourney } from "@/components/journey-provider";

/** Server sends `attemptNumber`, `closedAs`, `passed`, section tenths, etc. */
export interface ScreeningResultData {
  attemptNumber: number;
  closedAs: "SUBMITTED" | "EXPIRED";
  passed: boolean;
  sectionScoresTenths: Record<ScreeningSection, number>;
  totalTenths: number;
  maxTenths: number;
  scored90Plus: boolean;
  submittedAt: string;
  nextAttemptDate: string | null;
  suspended: boolean;
}

const sectionMetas: { key: ScreeningSection; enabled: boolean }[] = (
  Object.keys(SCREENING_SECTIONS) as ScreeningSection[]
).map((key) => ({ key, enabled: SCREENING_SECTIONS[key].enabled }));

const sectionNames: Record<ScreeningSection, string> = {
  LANGUAGE: "Language",
  READING: "Reading",
  CHAT: "Chat",
  JUDGMENT: "Judgment",
};

/** 125 tenths -> "12.5"; 400 -> "40". */
function pointsFromTenths(tenths: number): string {
  const whole = tenths / 10;
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(1);
}

/** "2026-11-01T08:00:00.000Z" -> "2026-11-01". */
function retakeDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ScreeningResult({
  result,
  variant,
}: {
  result: ScreeningResultData;
  variant: "page" | "last-attempt";
}) {
  const journey = useJourney();
  const router = useRouter();

  const enabledSections = sectionMetas.filter((meta) => meta.enabled);

  return (
    <section className="clay p-5" aria-live="polite">
      <h2 className="text-lg font-semibold">
        {result.passed ? "You passed the screening test." : "You didn't pass this time."}
      </h2>

      <p className="mt-1.5 text-sm text-muted-foreground">
        Attempt {result.attemptNumber} — scored {pointsFromTenths(result.totalTenths)} out of{" "}
        {pointsFromTenths(result.maxTenths)}; the pass mark is {SCREENING_PASS_PERCENT}%.
      </p>

      {result.closedAs === "EXPIRED" ? (
        <p className="mt-2 text-sm text-destructive">Time ran out on this attempt.</p>
      ) : null}

      <dl className="mt-4 space-y-1.5">
        {enabledSections.map(({ key }) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{sectionNames[key]}</dt>
            <dd className="text-sm font-medium tabular-nums">
              {pointsFromTenths(result.sectionScoresTenths?.[key] ?? 0)} /{" "}
              {pointsFromTenths(SCREENING_SECTIONS[key].pointsTenths)}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
          <dt className="text-sm font-medium">Total</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {pointsFromTenths(result.totalTenths)} / {pointsFromTenths(result.maxTenths)}
          </dd>
        </div>
      </dl>

      {result.suspended ? (
        <p className="mt-4 text-sm text-destructive">
          After three failed attempts your account is under review. Contact support to sort it
          out — you won't be able to sign in while this is in place.
        </p>
      ) : null}

      {!result.passed && result.nextAttemptDate && !result.suspended ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You can try again on {retakeDate(result.nextAttemptDate)}.
        </p>
      ) : null}

      {variant === "page" ? (
        <div className="mt-5 space-y-3">
          {!result.suspended && result.passed ? (
            <Button
              className="min-h-11 w-full text-sm"
              onClick={() => router.replace(ROUTES.tier)}
            >
              Choose your tier
            </Button>
          ) : null}
          {!result.suspended && !result.passed && journey.journeyState === "ready" ? (
            <Button
              variant="outline"
              className="min-h-11 w-full text-sm"
              onClick={() => void journey.recoverToJourney()}
            >
              Go to my next step
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
