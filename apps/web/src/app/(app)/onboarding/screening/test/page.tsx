import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { ScreeningTest } from "@/components/screening-test";

const ALLOWED = [ONBOARDING_STATUS.SCREENING_IN_PROGRESS] as const;

// Step 2b: questions with the server-owned countdown, auto-save queue, and
// confirm-before-submit. Expired attempts end on the result path, not an
// error page.
export default function ScreeningTestPage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 2" title="Screening test">
        <ScreeningTest />
      </PageShell>
    </JourneyGate>
  );
}
