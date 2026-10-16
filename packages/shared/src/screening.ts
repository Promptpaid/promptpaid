import { z } from "zod";

// ---------------------------------------------------------------------------
// Screening test (onboarding steps 5 and 6): shared rules only.
// The Prisma enums `ScreeningSection` / `ScreeningAttemptStatus` mirror the
// constants below. All points are stored as TENTHS of a point (integers) so
// scoring never uses floating point.
// ---------------------------------------------------------------------------

export const SCREENING_SECTION = {
  LANGUAGE: "LANGUAGE",
  READING: "READING",
  CHAT: "CHAT",
  JUDGMENT: "JUDGMENT",
} as const;

export type ScreeningSection =
  (typeof SCREENING_SECTION)[keyof typeof SCREENING_SECTION];

export const SCREENING_ATTEMPT_STATUS = {
  OPEN: "OPEN",
  SUBMITTED: "SUBMITTED",
  EXPIRED: "EXPIRED",
} as const;

export type ScreeningAttemptStatus =
  (typeof SCREENING_ATTEMPT_STATUS)[keyof typeof SCREENING_ATTEMPT_STATUS];

export interface ScreeningSectionSetting {
  /** Human points for display (25, 15, 40, 20). */
  points: number;
  /** Integer tenths of a point (250, 150, 400, 200). Canonical for scoring. */
  pointsTenths: number;
  /** How many questions to draw for this section (0 for non-MCQ chat). */
  questionCount: number;
  /** Only enabled sections count toward the maximum and are drawn. */
  enabled: boolean;
}

export const SCREENING_SECTIONS: Record<ScreeningSection, ScreeningSectionSetting> = {
  LANGUAGE: { points: 25, pointsTenths: 250, questionCount: 10, enabled: true },
  READING: { points: 15, pointsTenths: 150, questionCount: 3, enabled: true },
  // INTERIM RULE: chat simulation is not built yet, so it stays disabled.
  // The maximum and pass mark derive from enabled sections only, so enabling
  // chat later flips the max 60 -> 100 and the pass mark 42 -> 70 with no
  // other code change.
  CHAT: { points: 40, pointsTenths: 400, questionCount: 0, enabled: false },
  JUDGMENT: { points: 20, pointsTenths: 200, questionCount: 5, enabled: true },
};

/** Pass mark as a whole percent (70 = 70%). */
export const SCREENING_PASS_PERCENT = 70;

/** Time limit and grace, in seconds (single source of truth). */
export const SCREENING_TIME_LIMIT_SEC = 20 * 60;
export const SCREENING_GRACE_SEC = 30;

export const SCREENING_TIME_LIMIT_MS = SCREENING_TIME_LIMIT_SEC * 1000;
export const SCREENING_GRACE_MS = SCREENING_GRACE_SEC * 1000;

/** Score at or above this percent sets the scored-90-plus flag. */
export const SCREENING_HIGH_SCORE_PERCENT = 90;

// ---------------------------------------------------------------------------
// Derived scoring helpers (all integer maths on tenths)
// ---------------------------------------------------------------------------

export function enabledScreeningSections(): ScreeningSection[] {
  return (Object.keys(SCREENING_SECTIONS) as ScreeningSection[]).filter(
    (section) => SCREENING_SECTIONS[section].enabled,
  );
}

/** Maximum available tenths, from enabled sections only. */
export function screeningMaxTenths(): number {
  return enabledScreeningSections().reduce(
    (sum, section) => sum + SCREENING_SECTIONS[section].pointsTenths,
    0,
  );
}

/** Pass threshold in tenths, ceiled to a whole tenth. */
export function screeningPassThresholdTenths(maxTenths: number): number {
  return Math.floor((maxTenths * SCREENING_PASS_PERCENT + 99) / 100);
}

/** High-score threshold in tenths (sets scored90Plus, nothing else). */
export function screeningHighScoreThresholdTenths(maxTenths: number): number {
  return Math.floor((maxTenths * SCREENING_HIGH_SCORE_PERCENT + 99) / 100);
}

export function screeningPassed(totalTenths: number, maxTenths: number): boolean {
  return totalTenths >= screeningPassThresholdTenths(maxTenths);
}

export function screeningScoredHigh(totalTenths: number, maxTenths: number): boolean {
  return totalTenths >= screeningHighScoreThresholdTenths(maxTenths);
}

/** Tenths per question for a section (exact division required for MCQ). */
export function screeningPointsPerQuestionTenths(section: ScreeningSection): number {
  const setting = SCREENING_SECTIONS[section];
  if (setting.questionCount <= 0) return 0;
  return Math.floor(setting.pointsTenths / setting.questionCount);
}

// ---------------------------------------------------------------------------
// Retake rules (assumptions per brief: 7d after 1st fail, 30d after 2nd,
// SUSPENDED on 3rd fail; attempts counted from the database)
// ---------------------------------------------------------------------------

export const SCREENING_RETAKE_AFTER_FIRST_FAIL_DAYS = 7;
export const SCREENING_RETAKE_AFTER_SECOND_FAIL_DAYS = 30;
export const SCREENING_MAX_FAILURES_BEFORE_SUSPEND = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Cooldown days for a given number of past failures (0 = no cooldown). */
export function screeningCooldownDays(failures: number): number {
  if (failures <= 0) return 0;
  if (failures === 1) return SCREENING_RETAKE_AFTER_FIRST_FAIL_DAYS;
  return SCREENING_RETAKE_AFTER_SECOND_FAIL_DAYS;
}

/** Earliest date a retake is allowed after a failure at `failedAt`. */
export function screeningNextAttemptDate(failedAt: Date, failures: number): Date {
  return new Date(failedAt.getTime() + screeningCooldownDays(failures) * DAY_MS);
}

// ---------------------------------------------------------------------------
// Request schemas (writes are POST; extra body fields are stripped by zod
// and never trusted for status/score/passed/tier)
// ---------------------------------------------------------------------------

const emptyBody = z.object({});

export const screeningStartSchema = emptyBody;
export const screeningCurrentSchema = emptyBody;
export const screeningSubmitSchema = emptyBody;
export const screeningResultSchema = emptyBody;

export const screeningAnswerSchema = z.object({
  answers: z
    .array(
      z.object({
        attemptQuestionId: z.string().min(1),
        chosenDisplayedIndex: z.number().int().min(0).max(10),
      }),
    )
    .min(1)
    .max(50),
});

export type ScreeningStartInput = z.infer<typeof screeningStartSchema>;
export type ScreeningCurrentInput = z.infer<typeof screeningCurrentSchema>;
export type ScreeningAnswerInput = z.infer<typeof screeningAnswerSchema>;
export type ScreeningSubmitInput = z.infer<typeof screeningSubmitSchema>;
export type ScreeningResultInput = z.infer<typeof screeningResultSchema>;
