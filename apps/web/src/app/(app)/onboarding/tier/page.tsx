import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { TierPicker } from "@/components/tier-picker";

// TIER_CHOSEN stays allowed so people can change their mind before paying,
// exactly like the server's gate (choose_tier allows both).
const ALLOWED = [ONBOARDING_STATUS.SCREENING_PASSED, ONBOARDING_STATUS.TIER_CHOSEN] as const;

// Step 3: catalog from GET /onboarding/tiers, choice via POST /onboarding/tier.
export default function TierPage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 3" title="Choose your tier">
        <TierPicker />
      </PageShell>
    </JourneyGate>
  );
}
