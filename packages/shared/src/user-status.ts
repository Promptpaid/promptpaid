// Canonical account status values. The Prisma `UserStatus` enum is the source
// of truth in the database; these constants must mirror it so middleware and
// services compare against one shared list instead of typed-in strings.
//
// Note: the product plan calls a disabled account "frozen"; in the data model
// that maps to `SUSPENDED`.
export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
