"use client";

// The tier screen (step 3). The catalog and prices come from
// GET /onboarding/tiers (shared settings served by the server) — nothing is
// hardcoded here. Closed tiers show as "coming soon". Choosing a tier calls
// POST /onboarding/tier with the tier name only; the server re-checks the
// position, looks the price up itself, writes selectedTier only, and the
// journey router then sends the user to the payment screen.
//
// Choosing grants no benefits: the account's tier changes only after the
// activation payment clears, so the copy never implies access yet.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatNaira, type TierName } from "@promptpaid/shared";
import { useJourney } from "@/components/journey-provider";
import { Button } from "@promptpaid/ui/components/button";
import { ErrorRetry } from "@/components/error-retry";

interface TierFromApi {
  name: TierName;
  price: number;
  dailyConversations: number;
  ratePerConversation: number;
  withdrawalThreshold: number;
  open: boolean;
}

const TIER_LABELS: Record<TierName, string> = {
  ROOKIE: "Rookie",
  ELITE: "Elite",
  LEGENDARY: "Legendary",
};

export function TierPicker() {
  const journey = useJourney();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierFromApi[]>([]);
  const [selected, setSelected] = useState<TierName | null>(
    journey.statusData?.selectedTier ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null); // 400 tier-field errors
  const [alert, setAlert] = useState<string | null>(null); // retryable failures (429/5xx/offline)

  const loadTiers = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const res = await api<{ tiers: TierFromApi[] }>("/onboarding/tiers");
      setTiers(res.tiers);
      setLoadState("ready");
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "unauthorized") {
          // Cookie gone: journey re-read clears the session to login.
          await journey.loadStatus(true);
          return;
        }
        if (error.kind === "wrong_status") {
          await journey.recoverToJourney();
          return;
        }
        setLoadState("error");
        setLoadError(error.message);
        return;
      }
      setLoadState("error");
      setLoadError("No connection. Check your data and try again.");
    }
  }, [journey]);

  useEffect(() => {
    void loadTiers();
  }, [loadTiers]);

  const submitRef = useRef<(tier: TierName) => Promise<void> | undefined>(undefined);
  submitRef.current = async (tier) => {
    if (submitting) return;
    setSubmitting(true);
    setGroupError(null);
    setAlert(null);
    try {
      await api("/onboarding/tier", { method: "POST", body: { tier } });
      // The journey position moved to TIER_CHOSEN: re-read the status and
      // let the status router send the user to the payment screen.
      await journey.recoverToJourney();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "unauthorized") {
          await journey.loadStatus(true);
          return;
        }
        if (error.kind === "wrong_status") {
          // Includes the "refused" case (a payment is underway for another
          // tier): the payment screen states the live situation anyway.
          await journey.recoverToJourney();
          return;
        }
        if (error.kind === "fields" && error.fieldErrors.tier) {
          setGroupError(error.fieldErrors.tier[0] ?? null);
          return;
        }
        setAlert(error.message);
      } else {
        setAlert("No connection. Check your data and try again.");
      }
      setSubmitting(false);
    }
  };

  if (loadState === "loading") {
    return (
      <p className="clay p-5 text-sm text-muted-foreground" aria-live="polite">
        Loading the tiers…
      </p>
    );
  }

  if (loadState === "error" || tiers.length === 0) {
    return (
      <ErrorRetry
        title="The tiers could not load"
        message={loadError ?? "Something went wrong. Please try again."}
        onRetry={() => void loadTiers()}
      />
    );
  }

  const chosen = tiers.find((tier) => tier.name === selected) ?? null;
  const chosenName: TierName | null = chosen && chosen.open ? chosen.name : null;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3" aria-describedby={groupError ? "tier-error" : undefined}>
        <legend className="sr-only">Choose a tier</legend>
        {tiers.map((tier) => {
          const isChosen = selected === tier.name;
          return (
            <label
              key={tier.name}
              className={`flex cursor-pointer items-start gap-3 rounded-[1rem] border p-4 ${
                isChosen ? "border-primary bg-primary/10" : "border-border bg-background"
              } ${tier.open ? "clay" : "opacity-60"}`}
            >
              <input
                type="radio"
                name="tier"
                value={tier.name}
                checked={isChosen}
                disabled={!tier.open || submitting}
                onChange={() => {
                  setSelected(tier.name);
                  setGroupError(null);
                  setAlert(null);
                }}
                className="mt-1 size-4 shrink-0 accent-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold">{TIER_LABELS[tier.name]}</span>
                  <span className="text-base font-semibold tabular-nums">
                    {formatNaira(tier.price)}
                  </span>
                </span>
                {tier.open ? (
                  <span className="mt-1 block space-y-0.5 text-sm text-muted-foreground">
                    <span className="block">
                      {tier.dailyConversations} conversations a day,{" "}
                      {formatNaira(tier.ratePerConversation)} each
                    </span>
                    <span className="block">
                      Withdrawals unlock at {formatNaira(tier.withdrawalThreshold)}
                    </span>
                    <span className="block">One-time activation payment</span>
                  </span>
                ) : (
                  <span className="mt-1 block text-sm text-muted-foreground">Coming soon</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Paid by bank transfer on the next screen. Your bank&apos;s charges may apply.
      </p>

      {groupError ? (
        <p id="tier-error" role="alert" className="clay-sm rounded-[1rem] p-3 text-sm text-destructive">
          {groupError}
        </p>
      ) : null}
      {alert ? (
        <p role="alert" className="clay-sm rounded-[1rem] p-3 text-sm text-destructive">
          {alert}
        </p>
      ) : null}

      <Button
        type="button"
        className="min-h-11 w-full text-sm"
        disabled={submitting || chosenName === null}
        onClick={() => {
          if (chosenName === null) return;
          void submitRef.current?.(chosenName);
        }}
      >
        {submitting
          ? "Setting up…"
          : chosenName !== null
            ? `Continue to payment — ${TIER_LABELS[chosenName]}`
            : "Choose a tier"}
      </Button>
    </div>
  );
}
