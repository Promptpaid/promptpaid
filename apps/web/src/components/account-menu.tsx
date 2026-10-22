"use client";

// Header control shown only while signed in. "Log out" ends this session;
// "Log out everywhere" ends every session the account holds. Both clear
// the client snapshot and land on /login — the server owns the cookie.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@promptpaid/ui/components/dropdown-menu";
import { Button } from "@promptpaid/ui/components/button";
import { ChevronDownIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/components/session-provider";

export function AccountMenu() {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (session.state !== "authenticated" || !session.user) return null;

  const firstName = session.user.name.split(/\s+/)[0] ?? session.user.name;

  async function signOut(logOutEverywhere: boolean) {
    setBusy(true);
    try {
      await api(logOutEverywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" });
      session.clear();
      router.replace(ROUTES.login);
      toast.success(logOutEverywhere ? "Signed out of all sessions." : "Signed out.");
    } catch (error) {
      if (error instanceof ApiError && error.kind === "unauthorized") {
        // Server already considers us signed out; finish on the client too.
        session.clear();
        router.replace(ROUTES.login);
        return;
      }
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't sign out. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" disabled={busy} className="min-h-8" />}
      >
        <span className="flex items-center gap-1">
          {firstName}
          <ChevronDownIcon className="size-3" aria-hidden="true" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={busy}
          onClick={() => void signOut(false)}
          className="min-h-11 text-sm"
        >
          Log out
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={busy}
          onClick={() => void signOut(true)}
          className="min-h-11 text-sm"
        >
          Log out everywhere
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
