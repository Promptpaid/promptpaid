import Link from "next/link";
import { GuestGate } from "@/components/guest-gate";
import { LoginForm } from "@/components/login-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <PageShell eyebrow="Welcome back" title="Sign in">
      <GuestGate>
        <div className="space-y-6">
          <LoginForm />
          <p className="text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </div>
      </GuestGate>
    </PageShell>
  );
}
