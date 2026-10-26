"use client";

import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { useJourney } from "@/components/journey-provider";
import { formatNaira } from "@promptpaid/shared";
import { TIERS, type TierName } from "@promptpaid/shared";

const ALLOWED = [ONBOARDING_STATUS.ACTIVATED] as const;

function HomeContent() {
  const journey = useJourney();
  const profile = journey.statusData?.profile;
  const tierName = profile?.tier as TierName | null;
  const selectedTierName = profile?.selectedTier as TierName | null;
  const tierSetting = tierName ? TIERS[tierName] : null;

  if (!profile) return null;

  return (
    <div className="space-y-5">
      {/* Profile summary */}
      <section className="clay p-5 space-y-4" aria-label="Your profile">
        <h2 className="text-base font-semibold">Your profile</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium text-right truncate">{profile.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium text-right truncate">{profile.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Country</dt>
            <dd className="font-medium text-right">{profile.country}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Languages</dt>
            <dd className="font-medium text-right">{profile.languages.join(", ") || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Skills</dt>
            <dd className="font-medium text-right">{profile.skills.join(", ") || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Timezone</dt>
            <dd className="font-medium text-right">{profile.timezone || "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Tier status */}
      <section className="clay p-5 space-y-3" aria-label="Tier status">
        <h2 className="text-base font-semibold">Your tier</h2>
        {tierSetting ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{tierSetting.name}</span> —{" "}
              {formatNaira(tierSetting.price)} activation
            </p>
            <p className="text-sm text-muted-foreground">
              {tierSetting.dailyConversations} conversations/day,{" "}
              {formatNaira(tierSetting.ratePerConversation)} each
            </p>
            <p className="text-sm text-muted-foreground">
              Withdrawals unlock at {formatNaira(tierSetting.withdrawalThreshold)}
            </p>
          </>
        ) : selectedTierName ? (
          <p className="text-sm text-muted-foreground">
            Tier selected: <span className="font-medium">{selectedTierName}</span> — awaiting activation
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No tier selected</p>
        )}
      </section>

      {/* Tasks coming soon */}
      <section className="clay p-5 text-center" aria-label="Tasks">
        <p className="text-sm font-medium">Tasks</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Conversation tasks are coming soon. You&apos;ll see them here once available.
        </p>
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Home" title="You're in">
        <HomeContent />
      </PageShell>
    </JourneyGate>
  );
}
