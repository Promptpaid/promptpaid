"use client";

// Account creation: name, email, phone in international format, password,
// country from the shared list, and the languages that are currently open
// (from @promptpaid/shared — the server rejects closed ones). After
// success the session context flips and GuestGate routes through the
// status router. Nothing is cleared on failure.

import { useState } from "react";
import {
  openLanguages,
  signUpSchema,
} from "@promptpaid/shared";
import { api, ApiError } from "@/lib/api";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { useSession } from "@/components/session-provider";
import { FieldError } from "@/components/field-error";
import { PasswordInput } from "@/components/password-field";
import { Input } from "@promptpaid/ui/components/input";
import { Label } from "@promptpaid/ui/components/label";
import { Button } from "@promptpaid/ui/components/button";

type FieldName =
  | "name"
  | "email"
  | "phone"
  | "password"
  | "country"
  | "languages";

const OPEN_LANGUAGES = openLanguages();

// Only the currently open languages are selectable; at launch that makes
// signup default to the single open language and one tap can undo it.
const DEFAULT_LANGUAGES = OPEN_LANGUAGES.length === 1 ? [OPEN_LANGUAGES[0]] : [];

function languageLabel(code: string): string {
  switch (code) {
    case "english":
      return "English";
    case "pidgin":
      return "Nigerian Pidgin";
    case "french":
      return "French";
    default:
      return code.charAt(0).toUpperCase() + code.slice(1);
  }
}

export function SignupForm() {
  const session = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dial, setDial] = useState<string>(COUNTRY_OPTIONS[0].dial);
  const [digits, setDigits] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState<string>(COUNTRY_OPTIONS[0].code);
  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearField(field: FieldName) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    if (formError) setFormError(null);
  }

  function toggleLanguage(code: string) {
    clearField("languages");
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const phone = `${dial}${digits.replace(/[\s-]/g, "")}`;

    // Convenience check only; the server judges the real thing.
    const parsed = signUpSchema.safeParse({
      name,
      email,
      phone,
      password,
      country,
      languages,
    });
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
      await api("/auth/signup", { method: "POST", body: parsed.data });
      // Session cookie set server-side; flip the context and let
      // GuestGate run the status router.
      const me = await session.refresh();
      if (!me) {
        setFormError(
          "Account created — but the connection stalled while loading your next step. Try again.",
        );
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "fields") {
          const allowed = new Set<string>([
            "name",
            "email",
            "phone",
            "password",
            "country",
            "languages",
          ]);
          const next: Partial<Record<FieldName, string>> = {};
          for (const [field, messages] of Object.entries(error.fieldErrors)) {
            if (allowed.has(field)) next[field as FieldName] = messages[0];
          }
          setFieldErrors(next);
          if (Object.keys(next).length === 0) setFormError(error.message);
        } else if (error.status === 409) {
          // Duplicate account: honest copy plus the way out.
          setFormError(
            `${error.message} If that's you, sign in instead below.`,
          );
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("Sign-up failed. Check your connection and try again.");
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
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Adaeze Okafor"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearField("name");
          }}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
          aria-invalid={Boolean(fieldErrors.name)}
          className="clay-field h-11 rounded-clay bg-background px-3.5 text-sm"
        />
        <FieldError id="name-error" message={fieldErrors.name} />
      </div>

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
        <Label htmlFor="phone">Phone number</Label>
        <div className="flex gap-2">
          <select
            id="phone-dial"
            name="phone-dial"
            value={dial}
            onChange={(e) => setDial(e.target.value)}
            aria-label="Country dial code"
            className="clay-field h-11 w-24 shrink-0 rounded-clay border-0 bg-background px-3 text-sm outline-none"
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.dial}>
                {c.dial}
              </option>
            ))}
          </select>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            placeholder="8012345678"
            autoComplete="tel-national"
            value={digits}
            onChange={(e) => {
              setDigits(e.target.value.replace(/[^\d\s]/g, ""));
              clearField("phone");
            }}
            aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
            aria-invalid={Boolean(fieldErrors.phone)}
            className="clay-field h-11 flex-1 rounded-clay bg-background px-3.5 text-sm"
          />
        </div>
        <FieldError id="phone-error" message={fieldErrors.phone} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="country">Country</Label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            clearField("country");
          }}
          aria-describedby={fieldErrors.country ? "country-error" : undefined}
          aria-invalid={Boolean(fieldErrors.country)}
          className="clay-field h-11 w-full rounded-clay border-0 bg-background px-3.5 text-sm outline-none"
        >
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <FieldError id="country-error" message={fieldErrors.country} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">
          Password
          <span className="block text-xs font-normal text-muted-foreground">
            At least 8 characters.
          </span>
        </Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
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

      <fieldset className="space-y-1.5">
        <legend className="text-xs leading-none text-muted-foreground">
          Work in
        </legend>
        <div className="flex flex-wrap gap-2.5 pt-1">
          {OPEN_LANGUAGES.map((code) => {
            const selected = languages.includes(code);
            return (
              <label
                key={code}
                className={`clay-sm clay-press inline-flex min-h-11 cursor-pointer select-none items-center px-4 text-sm ${
                  selected ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selected}
                  onChange={() => toggleLanguage(code)}
                />
                {languageLabel(code)}
              </label>
            );
          })}
        </div>
        <FieldError id="languages-error" message={fieldErrors.languages} />
      </fieldset>

      <Button type="submit" disabled={submitting} className="min-h-11 w-full text-sm">
        {submitting ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
