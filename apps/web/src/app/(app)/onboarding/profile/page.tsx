import { ONBOARDING_STATUS } from "@promptpaid/shared";
import { JourneyGate } from "@/components/journey-gate";
import { PageShell } from "@/components/page-shell";
import { ProfileForm } from "@/components/profile-form";

const ALLOWED = [ONBOARDING_STATUS.CREATED, ONBOARDING_STATUS.PROFILE_COMPLETE] as const;

export const metadata = { title: "Your profile" };

// Screen is decided by the gate: only CREATED and PROFILE_COMPLETE land
// here; anything else is routed by journeyRoute().
export default function ProfilePage() {
  return (
    <JourneyGate allowed={ALLOWED}>
      <PageShell eyebrow="Step 1" title="Your profile">
        <ProfileForm />
      </PageShell>
    </JourneyGate>
  );
}
