"use client";

import { useState } from "react";
import Link from "next/link";

import { waitlistSchema } from "@promptpaid/shared";
import { Button } from "@promptpaid/ui/components/button";
import { Input } from "@promptpaid/ui/components/input";
import { Label } from "@promptpaid/ui/components/label";
import { Loader2Icon } from "lucide-react";

const COUNTRIES = [
  { code: "NG", label: "Nigeria", dial: "+234" },
  { code: "ZA", label: "South Africa", dial: "+27" },
  { code: "GH", label: "Ghana", dial: "+233" },
  { code: "KE", label: "Kenya", dial: "+254" },
] as const;

const LANGUAGES: { value: string; label: string }[] = [
  { value: "english", label: "English" },
  { value: "pidgin", label: "Nigerian Pidgin" },
  { value: "yoruba", label: "Yoruba" },
  { value: "igbo", label: "Igbo" },
  { value: "hausa", label: "Hausa" },
  { value: "afrikaans", label: "Afrikaans" },
  { value: "zulu", label: "Zulu" },
  { value: "swahili", label: "Swahili" },
  { value: "french", label: "French" },
];

const INTERESTS = [
  "AI training",
  "Data labeling",
  "Prompt writing",
  "Content evaluation",
  "Remote work",
  "Part-time income",
  "Referrals",
  "Translation",
  "Research",
  "Community",
];

const SERVER_BASE = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/$/, "");

const FORM_MESSAGES = {
  name: "Enter your name (at least 2 characters).",
  email: "Enter a valid email address.",
  phone: "Enter your phone number, e.g. 8012345678.",
  country: "Choose your country.",
  languages: "Pick at least one language.",
  consent: "You must agree to the Privacy Notice to join.",
} as const;

type FieldErrors = Partial<Record<keyof typeof FORM_MESSAGES, string>>;

function Chip({
  selected,
  onToggle,
  children,
}: {
  selected: boolean;
  onToggle: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`clay-sm clay-press cursor-pointer select-none px-3.5 py-2.5 text-sm transition-colors ${
        selected ? "bg-primary text-primary-foreground" : "hover:text-foreground"
      }`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={selected}
        onChange={(e) => onToggle(e.target.checked)}
      />
      {children}
    </label>
  );
}

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dial, setDial] = useState<string>("+234");
  const [number, setNumber] = useState("");
  const [country, setCountry] = useState<string>("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [consent, setConsent] = useState<boolean>(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{
    kind: "idle" | "sending" | "success" | "duplicate" | "rate_limited" | "server_error";
    message?: string;
  }>({ kind: "idle" });

  const phone = `${dial}${number.replace(/\s/g, "")}`;

  function toggleLanguage(value: string) {
    setLanguages((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setErrors((prev) => ({ ...prev, languages: undefined }));
  }

  function toggleInterest(value: string) {
    setInterests((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= 10) return prev;
      return [...prev, value];
    });
  }

  function validate(): FieldErrors | null {
    const result = waitlistSchema.safeParse({
      name,
      email,
      phone,
      country,
      languages,
      interests,
      consent,
    });
    if (result.success) {
      setErrors({});
      return null;
    }
    const next: FieldErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof typeof FORM_MESSAGES;
      if (field && !next[field]) next[field] = FORM_MESSAGES[field];
    }
    setErrors(next);
    return next;
  }

  function validateField(field: keyof typeof FORM_MESSAGES) {
    const result = waitlistSchema.safeParse({
      name,
      email,
      phone,
      country,
      languages,
      interests,
      consent,
    });
    if (result.success) {
      setErrors({});
      return;
    }
    const missing = result.error.issues.some(
      (issue) => issue.path[0] === field,
    );
    setErrors((prev) => ({
      ...prev,
      [field]: missing ? FORM_MESSAGES[field] : undefined,
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "idle" });
    const fieldErrors = validate();
    if (fieldErrors) return;

    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${SERVER_BASE}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          languages,
          interests,
          consent,
          website,
        }),
      });

      if (res.status === 201) {
        setStatus({
          kind: "success",
          message: "You're on the list! Check your email for a confirmation.",
        });
        return;
      }
      if (res.status === 200) {
        setStatus({ kind: "duplicate", message: "You're already on the waitlist." });
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => null);
        const serverErrors: FieldErrors = {};
        for (const key of Object.keys(FORM_MESSAGES) as Array<
          keyof typeof FORM_MESSAGES
        >) {
          const list = data?.errors?.[key];
          if (Array.isArray(list) && list[0]) serverErrors[key] = list[0];
        }
        setErrors(Object.keys(serverErrors).length ? serverErrors : FORM_MESSAGES);
        return;
      }
      if (res.status === 429) {
        setStatus({
          kind: "rate_limited",
          message:
            "Too many attempts from this device. Please wait a few minutes and try again.",
        });
        return;
      }
      setStatus({
        kind: "server_error",
        message:
          "We couldn't reach the server. Your details are saved below — please try again in a moment.",
      });
    } catch {
      setStatus({
        kind: "server_error",
        message:
          "We couldn't reach the server. Your details are saved below — please try again in a moment.",
      });
    }
  }

  const isSending = status.kind === "sending";
  const statusTone =
    status.kind === "success" || status.kind === "duplicate" ? "success" : "error";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
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
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
          onBlur={() => validateField("name")}
          aria-invalid={Boolean(errors.name)}
          className="clay-field h-11 rounded-clay bg-background px-3.5 text-sm"
        />
        {errors.name && (
          <p id="name-error" className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          onBlur={() => validateField("email")}
          aria-invalid={Boolean(errors.email)}
          className="clay-field h-11 rounded-clay bg-background px-3.5 text-sm"
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <div className="flex gap-2">
          <select
            id="phone-dial"
            name="phoneDial"
            value={dial}
            onChange={(e) => setDial(e.target.value)}
            aria-label="Dial code"
            className="clay-field h-11 w-28 shrink-0 rounded-clay border-0 bg-background px-3 text-sm outline-none"
          >
            {COUNTRIES.map((c) => (
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
            value={number}
            onChange={(e) => {
              setNumber(e.target.value.replace(/[^\d\s]/g, ""));
              if (errors.phone)
                setErrors((prev) => ({ ...prev, phone: undefined }));
            }}
            onBlur={() => validateField("phone")}
            aria-invalid={Boolean(errors.phone)}
            className="clay-field h-11 flex-1 rounded-clay bg-background px-3.5 text-sm"
          />
        </div>
        {errors.phone && (
          <p id="phone-error" className="text-sm text-destructive">
            {errors.phone}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="country">Country</Label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            if (errors.country)
              setErrors((prev) => ({ ...prev, country: undefined }));
          }}
          onBlur={() => validateField("country")}
          aria-invalid={Boolean(errors.country)}
          className="clay-field h-11 w-full rounded-clay border-0 bg-background px-3.5 text-sm outline-none"
        >
          <option value="" disabled>
            Choose your country
          </option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        {errors.country && (
          <p id="country-error" className="text-sm text-destructive">
            {errors.country}
          </p>
        )}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs leading-none">Languages you speak</legend>
        <div className="flex flex-wrap gap-2.5 pt-1">
          {LANGUAGES.map((lang) => (
            <Chip
              key={lang.value}
              selected={languages.includes(lang.value)}
              onToggle={(checked) => {
                if (checked) toggleLanguage(lang.value);
                else setLanguages((prev) => prev.filter((v) => v !== lang.value));
              }}
            >
              {lang.label}
            </Chip>
          ))}
        </div>
        {errors.languages && (
          <p className="text-sm text-destructive">{errors.languages}</p>
        )}
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-xs leading-none">
          What interests you{" "}
          <span className="text-muted-foreground">(optional, up to 10)</span>
        </legend>
        <div className="flex flex-wrap gap-2.5 pt-1">
          {INTERESTS.map((interest) => (
            <Chip
              key={interest}
              selected={interests.includes(interest)}
              onToggle={(checked) => {
                if (checked) toggleInterest(interest);
                else
                  setInterests((prev) => prev.filter((v) => v !== interest));
              }}
            >
              {interest}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div>
        <Label className="flex cursor-pointer items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            name="consent"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (errors.consent)
                setErrors((prev) => ({ ...prev, consent: undefined }));
            }}
            aria-invalid={Boolean(errors.consent)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            I agree to the{" "}
            <Link href="/privacy" className="font-medium text-primary underline underline-offset-2">
              Privacy Notice
            </Link>{" "}
            and consent to being contacted about the waitlist.
          </span>
        </Label>
        {errors.consent && (
          <p className="mt-1.5 text-sm text-destructive">{errors.consent}</p>
        )}
      </div>

      <div
        aria-hidden="true"
        className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      >
        <Label htmlFor="website">Leave this field empty</Label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {(status.kind === "success" ||
        status.kind === "duplicate" ||
        status.kind === "rate_limited" ||
        status.kind === "server_error") && (
        <div
          role={status.kind === "success" ? "status" : "alert"}
          className={`clay-sm px-4 py-3 text-sm ${
            statusTone === "success"
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {status.message}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={isSending}
        className="min-h-12 w-full rounded-clay px-6 text-base"
      >
        {isSending ? (
          <>
            <Loader2Icon className="animate-spin" />
            Joining…
          </>
        ) : (
          "Join the waitlist"
        )}
      </Button>
    </form>
  );
}