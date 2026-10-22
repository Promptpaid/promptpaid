import { z } from "zod";
import { USER_STATUS, type UserStatus } from "./user-status";
import { WAITLIST_LANGUAGES } from "./waitlist";

// ---------------------------------------------------------------------------
// Journey position
// ---------------------------------------------------------------------------

export const ONBOARDING_STATUS = {
  CREATED: "CREATED",
  PROFILE_COMPLETE: "PROFILE_COMPLETE",
  SCREENING_IN_PROGRESS: "SCREENING_IN_PROGRESS",
  SCREENING_PASSED: "SCREENING_PASSED",
  TIER_CHOSEN: "TIER_CHOSEN",
  ACTIVATED: "ACTIVATED",
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

export const ONBOARDING_STATUS_ORDER: readonly OnboardingStatus[] = [
  ONBOARDING_STATUS.CREATED,
  ONBOARDING_STATUS.PROFILE_COMPLETE,
  ONBOARDING_STATUS.SCREENING_IN_PROGRESS,
  ONBOARDING_STATUS.SCREENING_PASSED,
  ONBOARDING_STATUS.TIER_CHOSEN,
  ONBOARDING_STATUS.ACTIVATED,
];

// ---------------------------------------------------------------------------
// Languages (at most nine, all listed; `open` decides which are selectable)
// ---------------------------------------------------------------------------

export type LanguageCode = (typeof WAITLIST_LANGUAGES)[number];

export interface Language {
  code: LanguageCode;
  open: boolean;
}

// Launch is English-only. Opening another language is a one-line change here.
export const LANGUAGES: readonly Language[] = WAITLIST_LANGUAGES.map((code) => ({
  code,
  open: code === "english",
}));

export function openLanguages(): LanguageCode[] {
  return LANGUAGES.filter((language) => language.open).map((language) => language.code);
}

const OPEN_LANGUAGE_CODES = openLanguages() as [LanguageCode, ...LanguageCode[]];

// ---------------------------------------------------------------------------
// Next step wording (shared so web and server never disagree)
// ---------------------------------------------------------------------------

export const NEXT_STEP: Record<OnboardingStatus, string> = {
  CREATED: "Complete your profile.",
  PROFILE_COMPLETE: "Start the screening test.",
  SCREENING_IN_PROGRESS: "Resume the screening test.",
  SCREENING_PASSED: "Choose your tier.",
  TIER_CHOSEN: "Pay for your tier.",
  ACTIVATED: "Complete the onboarding tutorial, then start tasks.",
};

// A frozen or suspended account overrides every journey step.
export function nextStepFor(input: {
  accountStatus: UserStatus;
  onboardingStatus: OnboardingStatus;
}): string {
  if (input.accountStatus !== USER_STATUS.ACTIVE) return "Contact support.";
  return NEXT_STEP[input.onboardingStatus];
}

// ---------------------------------------------------------------------------
// Action gate: which onboarding statuses may perform which action
// ---------------------------------------------------------------------------

export type OnboardingAction =
  | "save_profile"
  | "screening_start"
  | "screening_answer"
  | "screening_submit"
  | "screening_result"
  | "choose_tier"
  | "start_payment"
  | "get_pin"
  | "activate";

export const ACTION_ALLOWED_STATUSES: Record<
  OnboardingAction,
  readonly OnboardingStatus[]
> = {
  save_profile: [ONBOARDING_STATUS.CREATED, ONBOARDING_STATUS.PROFILE_COMPLETE],
  // Start covers both the fresh start (PROFILE_COMPLETE) and the idempotent
  // retry while an attempt is still open (SCREENING_IN_PROGRESS returns the
  // open attempt instead of creating another).
  screening_start: [
    ONBOARDING_STATUS.PROFILE_COMPLETE,
    ONBOARDING_STATUS.SCREENING_IN_PROGRESS,
  ],
  screening_answer: [ONBOARDING_STATUS.SCREENING_IN_PROGRESS],
  // Submit is safe to repeat: after grading the user has already moved to
  // PASSED or back to PROFILE_COMPLETE, and a repeat call from there returns
  // the stored result instead of grading again.
  screening_submit: [
    ONBOARDING_STATUS.SCREENING_IN_PROGRESS,
    ONBOARDING_STATUS.SCREENING_PASSED,
    ONBOARDING_STATUS.PROFILE_COMPLETE,
  ],
  // Result is readable while testing, after passing, after failing back to
  // PROFILE_COMPLETE, and later (tier/payment) so users can review history.
  screening_result: [
    ONBOARDING_STATUS.PROFILE_COMPLETE,
    ONBOARDING_STATUS.SCREENING_IN_PROGRESS,
    ONBOARDING_STATUS.SCREENING_PASSED,
    ONBOARDING_STATUS.TIER_CHOSEN,
    ONBOARDING_STATUS.ACTIVATED,
  ],
  // Choosing is allowed fresh from SCREENING_PASSED and again from
  // TIER_CHOSEN so a user can change their mind before paying. It never
  // grants benefits; payment is a later step.
  choose_tier: [ONBOARDING_STATUS.SCREENING_PASSED, ONBOARDING_STATUS.TIER_CHOSEN],
  // Payment starts only from TIER_CHOSEN; the service additionally requires
  // the user to have a selectedTier and no non-terminal payment (safe to
  // repeat: an unexpired payment is returned, not duplicated).
  start_payment: [ONBOARDING_STATUS.TIER_CHOSEN],
  // Pin issuance stays available while the journey sits at TIER_CHOSEN with a
  // CONFIRMED payment; it is refused after activation.
  get_pin: [ONBOARDING_STATUS.TIER_CHOSEN],
  // Activation moves TIER_CHOSEN -> ACTIVATED once. ACTIVATED stays in the
  // allowed list so a repeat call returns success without writing anything.
  activate: [ONBOARDING_STATUS.TIER_CHOSEN, ONBOARDING_STATUS.ACTIVATED],
};

// An action requires BOTH an active account and an allowed journey status.
export function canPerform(
  input: { accountStatus: UserStatus; onboardingStatus: OnboardingStatus },
  action: OnboardingAction,
): boolean {
  if (input.accountStatus !== USER_STATUS.ACTIVE) return false;
  return ACTION_ALLOWED_STATUSES[action].includes(input.onboardingStatus);
}

export const PROFILE_FIELDS = ["languages", "skills", "timezone"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export function editableProfileFields(status: OnboardingStatus): ProfileField[] {
  return ACTION_ALLOWED_STATUSES.save_profile.includes(status) ? [...PROFILE_FIELDS] : [];
}

// ---------------------------------------------------------------------------
// Timezone defaults (suggestion only; the user can change it)
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE_BY_COUNTRY: Record<string, string> = {
  NG: "Africa/Lagos",
  ZA: "Africa/Johannesburg",
  GH: "Africa/Accra",
  KE: "Africa/Nairobi",
};

export function defaultTimezoneForCountry(country: string): string | null {
  return DEFAULT_TIMEZONE_BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Profile input schema
// ---------------------------------------------------------------------------

const MAX_SKILLS = 10;
const MAX_SKILL_LENGTH = 40;
const MAX_TIMEZONE_LENGTH = 64;

// Control characters are stripped, skills trimmed, empties dropped and
// duplicates removed case-insensitively. Runs for web and server alike.
function cleanSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of skills) {
    const skill = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(skill);
  }
  return cleaned;
}

export const profileSchema = z.object({
  languages: z
    .array(z.enum(OPEN_LANGUAGE_CODES, { error: "That language is not open yet." }))
    .min(1, "Choose at least one language.")
    .refine(
      (languages) => new Set(languages).size === languages.length,
      "Remove duplicate languages.",
    ),
  skills: z
    .array(
      z
        .string()
        .trim()
        .max(MAX_SKILL_LENGTH, `Each skill must be at most ${MAX_SKILL_LENGTH} characters.`),
    )
    .max(MAX_SKILLS, `Add at most ${MAX_SKILLS} skills.`)
    .default([])
    .transform(cleanSkills),
  timezone: z
    .string()
    .trim()
    .min(1, "Choose a timezone.")
    .max(MAX_TIMEZONE_LENGTH, `Timezone must be at most ${MAX_TIMEZONE_LENGTH} characters.`),
});

export type ProfileInput = z.infer<typeof profileSchema>;
