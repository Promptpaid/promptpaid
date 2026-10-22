import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";

const ALLOWED = [ONBOARDING_STATUS.TIER_CHOSEN] as const;

// F1 scaffold: transfer details, polling and pin arrive in F6. Payment
// endpoints on the server are still partial (start/current only, no pin or
// activation routes yet) — flagged to the product owner in the F5 report.
export default function PaymentPage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 4" title="Payment">
        <p className="clay-field rounded-[1rem] p-4 text-sm text-muted-foreground">
          Bank transfer details and payment status arrive in a coming build phase.
        </p>
      </PageShell>
    </JourneyGate>
  );
}
