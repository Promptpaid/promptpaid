import Link from "next/link";
import { GuestGate } from "@/components/guest-gate";
import { SignupForm } from "@/components/signup-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <PageShell eyebrow="Get started" title="Create your account">
      <GuestGate>
        <div className="space-y-6">
          <SignupForm />
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </GuestGate>
    </PageShell>
  );
}
