import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { ScreeningRules } from "@/components/screening-rules";

const ALLOWED = [ONBOARDING_STATUS.PROFILE_COMPLETE] as const;

// Step 2a: rules from shared settings, last failed attempt (if any), and
// the Start button (POST /screening/start). SCREENING_IN_PROGRESS users are
// routed on to the questions screen by the journey router.
export default function ScreeningStartPage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 2" title="Screening test">
        <ScreeningRules />
      </PageShell>
    </JourneyGate>
  );
}
