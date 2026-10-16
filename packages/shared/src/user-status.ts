// Canonical account status values. The Prisma `UserStatus` enum is the source
// of truth in the database; these constants must mirror it so middleware and
// services compare against one shared list instead of typed-in strings.
//
// This is the account switch, not the onboarding journey. `FROZEN` and
// `SUSPENDED` both block the user everywhere (login + every onboarding action)
// regardless of where they are in the journey. Journey position lives in
// ONBOARDING_STATUS. Checks must use `!== ACTIVE` (never `=== FROZEN`) so a
// new blocked value can never slip through.
export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  FROZEN: "FROZEN",
  SUSPENDED: "SUSPENDED",
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
