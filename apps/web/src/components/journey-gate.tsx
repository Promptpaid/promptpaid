"use client";

// Route guard. Wraps a protected page; every decision goes through
// journeyRoute() from lib/routes — never page-local if-statements.
//
// - Logged out (401 from /auth/me or /onboarding/status) -> /login.
// - Signed in but on the wrong screen for the journey status -> redirected
//   to journeyRoute(status), unless the page declared this status allowed
//   (e.g. the profile screen stays open once the profile is complete).
// - Network/server failure -> honest retry, content unmounted until facts
//   are reconfirmed.

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { USER_STATUS, type OnboardingStatus } from "@promptpaid/shared";
import { journeyRoute, ROUTES } from "@/lib/routes";
import { useSession } from "@/components/session-provider";
import { useJourney } from "@/components/journey-provider";
import { Loading } from "@/components/loading";
import { ErrorRetry } from "@/components/error-retry";

interface JourneyGateProps {
  /**
   * Statuses this page legitimately handles. The journey's own screen for
   * the current status is always allowed by exact match anyway; pass the
   * overridable super-set here (profile: CREATED + PROFILE_COMPLETE).
   */
  allowed: readonly OnboardingStatus[];
  children: ReactNode;
}

export function JourneyGate({ allowed, children }: JourneyGateProps) {
  const session = useSession();
  const journey = useJourney();
  const router = useRouter();

  // One navigation effect for every decision the gate makes.
  useEffect(() => {
    if (session.state === "anonymous") {
      router.replace(ROUTES.login);
      return;
    }
    if (session.state !== "authenticated") return;

    if (journey.journeyState === "idle") {
      void journey.loadStatus();
      return;
    }

    const data = journey.statusData;
    if (data && journey.journeyState === "ready") {
      const allowedHere =
        allowed.includes(data.onboardingStatus) && data.accountStatus === USER_STATUS.ACTIVE;
      if (!allowedHere) {
        router.replace(journeyRoute(data.accountStatus, data.onboardingStatus));
      }
    }
  }, [session.state, journey.journeyState, journey.statusData, journey.loadStatus, allowed, router]);

  if (session.state === "loading") {
    return <Loading label="Checking your sign-in…" />;
  }
  if (session.state === "unavailable") {
    return (
      <ErrorRetry
        title="Can't check your sign-in"
        message="The connection is slow or the service is busy. Anything you typed was not lost."
        onRetry={() => void session.refresh()}
      />
    );
  }
  if (session.state === "anonymous") {
    return <Loading label="Taking you to sign in…" />;
  }

  if (journey.journeyState === "loading" || journey.journeyState === "idle") {
    return <Loading label="Finding your place…" />;
  }
  if (journey.journeyState === "unavailable" || journey.statusData === null) {
    return (
      <ErrorRetry
        title="Can't load your journey"
        message="The connection is slow or the service is busy. Anything you typed was not lost."
        onRetry={() => void journey.loadStatus(true)}
        retrying={false}
      />
    );
  }

  const data = journey.statusData;
  const allowedHere =
    data.accountStatus === USER_STATUS.ACTIVE && allowed.includes(data.onboardingStatus);

  if (allowedHere) return <>{children}</>;
  return <Loading label="Taking you to your next step…" />;
}
