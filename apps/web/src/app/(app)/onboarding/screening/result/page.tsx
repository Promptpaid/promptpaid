import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { ScreeningResultScreen } from "@/components/screening-result-screen";

// Both positions can legitimately view a result:
// - SCREENING_PASSED: just after passing.
// - PROFILE_COMPLETE: a failed (or expired) attempt landed here; the stored
//   result explains what happened and when a retake is possible.
const ALLOWED = [
  ONBOARDING_STATUS.SCREENING_PASSED,
  ONBOARDING_STATUS.PROFILE_COMPLETE,
] as const;

// Step 2c: section scores, pass or fail, and the retake date.
export default function ScreeningResultPage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 2" title="Your result">
        <ScreeningResultScreen />
      </PageShell>
    </JourneyGate>
  );
}
