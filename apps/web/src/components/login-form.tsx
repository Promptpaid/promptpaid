"use client";

// Sign-in form. Server is the judge: the shared login schema is used only
// to catch obvious slip-ups client-side; whatever the server answers is
// shown exactly (the 401 body is the generic "Invalid email or password."
// message and is displayed as sent). Input is never cleared on error.

import { useState } from "react";
import { loginSchema } from "@promptpaid/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { FieldError } from "@/components/field-error";
import { PasswordInput } from "@/components/password-field";
import { Input } from "@promptpaid/ui/components/input";
import { Label } from "@promptpaid/ui/components/label";
import { Button } from "@promptpaid/ui/components/button";

type FieldName = "email" | "password";

export function LoginForm() {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearField(field: FieldName) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    if (formError) setFormError(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Convenience check only; the server judges the real thing.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        if (field && !next[field]) next[field] = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      await api("/auth/login", { method: "POST", body: parsed.data });
      // Cookie is set server-side. Flip the session context; GuestGate
      // routes through the status router.
      const me = await session.refresh();
      if (!me) {
        // Rare: login worked but the follow-up check failed. Input stays;
        // one more tap finishes the navigation.
        setFormError("You're signed in, but the connection stalled while loading your next step. Try again.");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "fields") {
          const next: Partial<Record<FieldName, string>> = {};
          for (const [field, messages] of Object.entries(error.fieldErrors)) {
            if (field === "email" || field === "password") next[field] = messages[0];
          }
          setFieldErrors(next);
          if (!next.email && !next.password) setFormError(error.message);
        } else {
          // 401 shows the server's generic message exactly as sent;
          // 429/5xx/offline messages come from the same mapping.
          setFormError(error.message);
        }
      } else {
        setFormError("Sign-in failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError ? (
        <div role="alert" className="clay-sm p-4 text-sm text-destructive">
          {formError}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearField("email");
          }}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          aria-invalid={Boolean(fieldErrors.email)}
          className="clay-field h-11 rounded-clay bg-background px-3.5 text-sm"
        />
        <FieldError id="email-error" message={fieldErrors.email} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onValueChange={(v) => {
            setPassword(v);
            clearField("password");
          }}
          ariaDescribedBy={fieldErrors.password ? "password-error" : undefined}
          invalid={Boolean(fieldErrors.password)}
        />
        <FieldError id="password-error" message={fieldErrors.password} />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11 w-full text-sm">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
