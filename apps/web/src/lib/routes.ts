// The one place that decides which screen a user sees.
//
// Rule from the product contract: the screen is decided ONLY by
// GET /onboarding/status. After login, after each finished step, and after
// any 409 wrong-status reply, the client re-reads the status and calls
// journeyRoute(). No page ever "knows" where the journey is on its own.

import {
  ONBOARDING_STATUS,
  USER_STATUS,
  type OnboardingStatus,
  type UserStatus,
} from "@promptpaid/shared";
import type { Route } from "next";

const r = (path: string) => path as Route;

export const ROUTES = {
  login: r("/login"),
  signup: r("/signup"),
  profile: r("/onboarding/profile"),
  screeningStart: r("/onboarding/screening"),
  screeningTest: r("/onboarding/screening/test"),
  screeningResult: r("/onboarding/screening/result"),
  tier: r("/onboarding/tier"),
  payment: r("/onboarding/payment"),
  home: r("/home"),
} as const;

/** Journey position -> screen, derived from the shared NEXT_STEP map. */
export const JOURNEY_ROUTE: Record<OnboardingStatus, Route> = {
  [ONBOARDING_STATUS.CREATED]: ROUTES.profile,
  [ONBOARDING_STATUS.PROFILE_COMPLETE]: ROUTES.screeningStart,
  [ONBOARDING_STATUS.SCREENING_IN_PROGRESS]: ROUTES.screeningTest,
  [ONBOARDING_STATUS.SCREENING_PASSED]: ROUTES.screeningResult,
  [ONBOARDING_STATUS.TIER_CHOSEN]: ROUTES.payment,
  [ONBOARDING_STATUS.ACTIVATED]: ROUTES.home,
};

/**
 * Map an account position to the route for it. Unknown positions and
 * frozen/suspended accounts all land on login (the server 401s sessions it
 * deletes for inactive accounts, so login is where they re-appear).
 */
export function journeyRoute(
  accountStatus: UserStatus | string,
  onboardingStatus: OnboardingStatus | string,
): Route {
  if (accountStatus !== USER_STATUS.ACTIVE) return ROUTES.login;
  const byStatus = JOURNEY_ROUTE as Record<string, Route | undefined>;
  return byStatus[onboardingStatus] ?? ROUTES.login;
}
