"use client";

// Holds "who is signed in?" for the app screens.
//
// On mount it asks GET /auth/me. There is nothing to persist: the session
// lives in a server-owned httpOnly cookie, never in web storage or
// JavaScript-readable cookies. We keep just the small public user snapshot
// in React state.

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
import { api, ApiError } from "@/lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  status: string;
}

export type SessionState = "loading" | "authenticated" | "anonymous" | "unavailable";

interface SessionContextValue {
  state: SessionState;
  user: SessionUser | null;
  /** Ask the server who we are; safe to call again at any time. */
  refresh: () => Promise<SessionUser | null>;
  /** Drop the client-side snapshot (401 handling); the server owns the cookie. */
  clear: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const inFlight = useRef<Promise<SessionUser | null> | null>(null);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    // One request at a time: a burst of mounts reuses the same promise.
    inFlight.current ??= (async () => {
      try {
        const data = await api<{ user: SessionUser }>("/auth/me");
        setUser(data.user);
        setState("authenticated");
        return data.user;
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthorized") {
          // Definitive answer: no usable session. Clear client state only.
          setUser(null);
          setState("anonymous");
          return null;
        }
        // Offline or server trouble: keep whatever state we had and let the
        // caller (gate) show a retry, instead of bouncing people to login
        // while the network is merely slow.
        setState((prev) => (prev === "loading" ? "unavailable" : prev));
        return null;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setState("anonymous");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ state, user, refresh, clear }),
    [state, user, refresh, clear],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>.");
  return ctx;
}
