import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";

const ALLOWED = [ONBOARDING_STATUS.ACTIVATED] as const;

// F1 scaffold: the real home shell arrives in F7 (tasks come-later state).
export default function HomePage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Home" title="You're in">
        <p className="clay-field rounded-[1rem] p-4 text-sm text-muted-foreground">
          Tasks and your profile area arrive in a coming build phase.
        </p>
      </PageShell>
    </JourneyGate>
  );
}
