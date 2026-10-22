"use client";

// Holds the journey answer from GET /onboarding/status — the ONLY source
// used to decide which screen the user sees. Consumed by the route guard,
// by the login flow, and by every "409 wrong status" recovery:
//
//   recoverToJourney()  ->  re-read status -> journeyRoute() -> replace.
//
// The status is fetched lazily (gates request it), refetchable at any time,
// and reset when the session goes away.

import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  OnboardingStatus,
  ProfileField,
  TierName,
  UserStatus,
} from "@promptpaid/shared";
import { api, ApiError } from "@/lib/api";
import { journeyRoute } from "@/lib/routes";
import { useSession } from "@/components/session-provider";

export interface JourneyProfileSnapshot {
  id: string;
  name: string;
  email: string;
  country: string;
  languages: string[];
  skills: string[];
  timezone: string | null;
  tier: string | null;
  selectedTier: string | null;
}

export interface JourneyStatusData {
  accountStatus: UserStatus;
  onboardingStatus: OnboardingStatus;
  nextStep: string;
  profile: JourneyProfileSnapshot;
  selectedTier: TierName | null;
  editableFields: ProfileField[];
}

export type JourneyState = "idle" | "loading" | "ready" | "unavailable";

interface JourneyContextValue {
  journeyState: JourneyState;
  statusData: JourneyStatusData | null;
  /** Read (or re-read) GET /onboarding/status. Force re-reads even if cached. */
  loadStatus: (force?: boolean) => Promise<JourneyStatusData | null>;
  /**
   * The server said "you can't do that from where you are" (409) or a step
   * just changed the position: re-read the status and send the user to the
   * screen journeyRoute() names. Returns the destination navigated to.
   */
  recoverToJourney: () => Promise<Route | null>;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const [journeyState, setJourneyState] = useState<JourneyState>("idle");
  const [statusData, setStatusData] = useState<JourneyStatusData | null>(null);
  const inFlight = useRef<Promise<JourneyStatusData | null> | null>(null);

  const loadStatus = useCallback(
    async (force = false): Promise<JourneyStatusData | null> => {
      if (session.state !== "authenticated") return null;
      if (!force) {
        // Cache: gates re-mounting after client navigations don't refetch.
        if (journeyState === "ready") return statusData;
        if (journeyState === "loading" && inFlight.current) return inFlight.current;
      }
      inFlight.current = (async () => {
        setJourneyState("loading");
        try {
          const data = await api<JourneyStatusData>("/onboarding/status");
          setStatusData(data);
          setJourneyState("ready");
          return data;
        } catch (error) {
          if (error instanceof ApiError && error.kind === "unauthorized") {
            // Cookie gone mid-flight: drop the journey snapshot; the
            // session 401 drives the redirect to login.
            setStatusData(null);
            setJourneyState("idle");
            session.clear();
            return null;
          }
          // Offline / 5xx: show retry in the gate, never auto-hide content.
          setStatusData(null);
          setJourneyState("unavailable");
          return null;
        } finally {
          inFlight.current = null;
        }
      })();
      return await inFlight.current;
    },
    [journeyState, statusData, session.state, session.clear],
  );

  const recoverToJourney = useCallback(async (): Promise<Route | null> => {
    const data = await loadStatus(true);
    if (!data) return null;
    const target = journeyRoute(data.accountStatus, data.onboardingStatus);
    router.replace(target);
    return target;
  }, [loadStatus, router]);

  // Reset journey facts whenever the session disappears; start the first
  // status read once a session is confirmed (auto-load only from "idle" so
  // a persistent network failure waits for the user's retry press).
  useEffect(() => {
    if (session.state === "authenticated" && journeyState === "idle") {
      void loadStatus();
      return;
    }
    if (session.state === "anonymous") {
      // Clear client state: no journey facts survive a logged-out session.
      setStatusData(null);
      setJourneyState("idle");
    }
  }, [session.state, journeyState, loadStatus]);

  const value = useMemo<JourneyContextValue>(
    () => ({ journeyState, statusData, loadStatus, recoverToJourney }),
    [journeyState, statusData, loadStatus, recoverToJourney],
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used inside <JourneyProvider>.");
  return ctx;
}
