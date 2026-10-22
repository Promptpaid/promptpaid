"use client";

// Inverse of the route guard: for login and signup. A visitor who already
// has a usable session (or who just signs in/up on this page) is sent to
// journeyRoute() from lib/routes — after authentication the screen choice
// always comes from GET /onboarding/status, never from the form.
//
// Forms only call session.refresh() after a successful POST; this gate
// sees the state flip to "authenticated" and does the routing, so the
// status fetch is never racing a stale context value.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { journeyRoute } from "@/lib/routes";
import { useSession } from "@/components/session-provider";
import { useJourney } from "@/components/journey-provider";
import { Loading } from "@/components/loading";
import { ErrorRetry } from "@/components/error-retry";

export function GuestGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const journey = useJourney();
  const router = useRouter();
  const prevSession = useRef(session.state);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    // Route exactly once per "arrived authenticated here" transition:
    // covers both a page mounted before the /auth/me answer arrives and
    // this page's own login/signup success.
    const nowAuthenticated = session.state === "authenticated";
    const wasDifferent = prevSession.current !== session.state;
    prevSession.current = session.state;

    if (nowAuthenticated && wasDifferent) {
      void navigate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state]);

  async function navigate() {
    setStuck(false);
    const data = await journey.loadStatus(true);
    if (data) {
      router.replace(journeyRoute(data.accountStatus, data.onboardingStatus));
    } else {
      setStuck(true);
    }
  }

  if (session.state === "loading") {
    return <Loading label="Checking your sign-in…" />;
  }
  if (session.state === "authenticated") {
    return stuck ? (
      <ErrorRetry
        title="Almost there"
        message="You're signed in, but the connection stalled while loading your place. Nothing is lost."
        onRetry={() => void navigate()}
      />
    ) : (
      <Loading label="Taking you to your next step…" />
    );
  }
  if (session.state === "unavailable") {
    // The server is slow; the login form still works — let people try it.
    return <>{children}</>;
  }
  return <>{children}</>;
}
