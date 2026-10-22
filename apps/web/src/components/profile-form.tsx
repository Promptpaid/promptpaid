"use client";

// Profile setup and editing (step 1 of onboarding).
//
// - Prefilled from the journey context's GET /onboarding/status snapshot —
//   no duplicate request.
// - Language choices are only the open ones from @promptpaid/shared.
// - Skills: up to 10, each at most 40 characters, duplicates removed in the
//   UI (case-insensitive) — the same rules the shared profileSchema speeds.
// - Timezone: valid IANA zones only, suggested from the account's country
//   (shared default) plus the device zone.
// - The shared `editableFields` list decides what may be edited. Edits end
//   when screening starts (server gate; 409 routes to the real position).
// - Save goes to POST /onboarding/profile; after success the journey
//   context reloads and the next-step CTA routes through the status
//   router. Failures keep every typed value.

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TIMEZONE_BY_COUNTRY,
  defaultTimezoneForCountry,
  openLanguages,
  profileSchema,
} from "@promptpaid/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@promptpaid/ui/components/button";
import { Input } from "@promptpaid/ui/components/input";
import { Label } from "@promptpaid/ui/components/label";
import { XIcon } from "lucide-react";
import { useJourney } from "@/components/journey-provider";
import { ChipToggle } from "@/components/chip";
import { FieldError } from "@/components/field-error";

type ProfileFieldName = "languages" | "skills" | "timezone";

const OPEN_LANGUAGES: readonly string[] = openLanguages();

const languageLabels: Record<string, string> = {
  english: "English",
  pidgin: "Nigerian Pidgin",
  yoruba: "Yoruba",
  igbo: "Igbo",
  hausa: "Hausa",
  afrikaans: "Afrikaans",
  zulu: "Zulu",
  swahili: "Swahili",
  french: "French",
};

function languageLabel(code: string): string {
  return languageLabels[code] ?? code;
}

const MAX_SKILLS = 10;
const MAX_SKILL_LENGTH = 40;

/** Same cleaning as the shared schema: drop control characters, trim. */
function cleanSkillDraft(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

export function ProfileForm() {
  const journey = useJourney();
  const profile = journey.statusData?.profile ?? null;
  const editableFields = journey.statusData?.editableFields ?? [];

  const [languages, setLanguages] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileFieldName, string>>>({});
  const [formError, setFormError] = useState<{ message: string; retry?: () => void } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [savedNextStep, setSavedNextStep] = useState<string | null>(null);

  // Prefill once per profile snapshot (CREATED accounts keep empty lists;
  // returning users see what the server holds).
  useEffect(() => {
    if (!profile) return;
    setLanguages(profile.languages ?? []);
    setSkills(profile.skills ?? []);
    const deviceZone: string | null = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return null;
      }
    })();
    setTimezone(
      profile.timezone ??
        defaultTimezoneForCountry(profile.country) ??
        deviceZone ??
        "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const canEdit = (field: ProfileFieldName) => editableFields.includes(field);

  const timezoneOptions = useMemo(() => {
    const byValue = new Map<string, string>();
    const deviceZone: string | null = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return null;
      }
    })();
    for (const zone of Object.values(DEFAULT_TIMEZONE_BY_COUNTRY)) {
      if (!byValue.has(zone)) byValue.set(zone, zone);
    }
    if (deviceZone && !byValue.has(deviceZone)) {
      byValue.set(deviceZone, deviceZone);
    }
    return [...byValue.entries()].map(([value, zone]) => ({
      value,
      label:
        zone === (profile?.country ? defaultTimezoneForCountry(profile.country) : null)
          ? `${zone} — suggested`
          : zone === deviceZone
            ? `${zone} — this device`
            : zone,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.country]);

  if (!profile) return null;

  function addSkill() {
    const skill = cleanSkillDraft(skillDraft);
    if (!skill) return;
    if (skills.length >= MAX_SKILLS) {
      setFieldErrors((prev) => ({ ...prev, skills: `Add at most ${MAX_SKILLS} skills.` }));
      return;
    }
    if (skill.length > MAX_SKILL_LENGTH) {
      setFieldErrors((prev) => ({
        ...prev,
        skills: `Each skill must be at most ${MAX_SKILL_LENGTH} characters.`,
      }));
      return;
    }
    const duplicate = skills.find(
      (existing) => existing.toLowerCase() === skill.toLowerCase(),
    );
    if (duplicate) {
      setFieldErrors((prev) => ({
        ...prev,
        skills: `${duplicate} is already on your list.`,
      }));
      return;
    }
    setSkills((prev) => [...prev, skill]);
    setSkillDraft("");
    setFieldErrors((prev) => ({ ...prev, skills: undefined }));
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((s) => s !== skill));
    setFieldErrors((prev) => ({ ...prev, skills: undefined }));
  }

  async function save() {
    if (submitting) return;
    setFormError(null);
    setSavedNextStep(null);

    // Convenience check only; the server judges.
    const parsed = profileSchema.safeParse({ languages, skills, timezone });
    if (!parsed.success) {
      const next: Partial<Record<ProfileFieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as ProfileFieldName;
        if (field && !next[field]) next[field] = issue.message;
      }
      setFieldErrors((prev) => ({ ...prev, ...next }));
      return;
    }

    setSubmitting(true);
    try {
      const res = await api<{ nextStep: string }>("/onboarding/profile", {
        method: "POST",
        body: parsed.data,
      });
      setSavedNextStep(res.nextStep);
      setFieldErrors({});
      // Reload the journey snapshot so the gate and CTA see the new
      // journey position (PROFILE_COMPLETE after a first save).
      await journey.loadStatus(true);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === "fields") {
          const next: Partial<Record<ProfileFieldName, string>> = {};
          for (const [field, messages] of Object.entries(error.fieldErrors)) {
            if (field === "languages" || field === "skills" || field === "timezone") {
              next[field as ProfileFieldName] = messages[0];
            }
          }
          setFieldErrors(next);
          if (Object.keys(next).length === 0) {
            setFormError({ message: error.message, retry: () => void save() });
          }
        } else if (error.kind === "wrong_status") {
          // The journey moved (e.g. screening started in another tab): go
          // to the screen journeyRoute names for the real position.
          await journey.recoverToJourney();
          return;
        } else {
          setFormError({ message: error.message, retry: () => void save() });
        }
      } else {
        setFormError({
          message: "Saving failed. Check your connection and try again.",
          retry: () => void save(),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
      className="space-y-6"
    >
      {formError ? (
        <div role="alert" className="clay-sm p-4">
          <p className="text-sm text-destructive">{formError.message}</p>
          {formError.retry ? (
            <Button
              type="button"
              className="mt-3 min-h-11 w-full text-sm"
              onClick={formError.retry}
              disabled={submitting}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {savedNextStep ? (
        <div className="clay-sm p-4" aria-live="polite">
          <p className="text-sm font-medium">Profile saved.</p>
          <p className="mt-1 text-sm text-muted-foreground">{savedNextStep}</p>
          <Button
            type="button"
            className="mt-3 min-h-11 w-full text-sm"
            disabled={submitting}
            onClick={() => void journey.recoverToJourney()}
          >
            Continue
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            You can keep editing until your screening test starts.
          </p>
        </div>
      ) : null}

      <fieldset className="space-y-2" disabled={submitting}>
        <legend className="text-sm font-medium">Languages you can work in</legend>
        <div className="flex flex-wrap gap-2.5 pt-1">
          {OPEN_LANGUAGES.map((code) => (
            <ChipToggle
              key={code}
              selected={languages.includes(code)}
              disabled={submitting || !canEdit("languages")}
              onToggle={() => {
                if (!canEdit("languages")) return;
                setFieldErrors((prev) => ({ ...prev, languages: undefined }));
                setLanguages((prev) =>
                  prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
                );
              }}
            >
              {languageLabel(code)}
            </ChipToggle>
          ))}
        </div>
        <FieldError id="languages-error" message={fieldErrors.languages} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="skill">
          Skills
          <span className="block text-xs font-normal text-muted-foreground">
            Up to {MAX_SKILLS}, one at a time. {skills.length}/{MAX_SKILLS} added — duplicates
            are removed automatically.
          </span>
        </Label>
        {skills.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Your skills">
            {skills.map((skill) => (
              <li
                key={skill}
                className="clay-sm inline-flex min-h-11 items-center gap-1.5 px-3 text-sm"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                  className="inline-flex size-8 items-center justify-center rounded-[1rem] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Input
            id="skill"
            name="skill"
            value={skillDraft}
            inputMode="text"
            maxLength={MAX_SKILL_LENGTH + 1}
            placeholder="e.g. algebra, lesson planning"
            disabled={submitting || skills.length >= MAX_SKILLS || !canEdit("skills")}
            onChange={(e) => {
              setSkillDraft(e.target.value);
              setFieldErrors((prev) => ({ ...prev, skills: undefined }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkill();
              }
            }}
            aria-describedby={fieldErrors.skills ? "skills-error" : undefined}
            aria-invalid={Boolean(fieldErrors.skills)}
            className="clay-field h-11 flex-1 rounded-clay bg-background px-3.5 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={submitting || skills.length >= MAX_SKILLS || !canEdit("skills")}
            onClick={addSkill}
            className="min-h-11 shrink-0 text-sm"
          >
            Add
          </Button>
        </div>
        <FieldError id="skills-error" message={fieldErrors.skills} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">
          Timezone
          <span className="block text-xs font-normal text-muted-foreground">
            Suggested from your country and device — change it if different.
          </span>
        </Label>
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          disabled={submitting || !canEdit("timezone")}
          onChange={(e) => {
            setTimezone(e.target.value);
            setFieldErrors((prev) => ({ ...prev, timezone: undefined }));
          }}
          aria-describedby={fieldErrors.timezone ? "timezone-error" : undefined}
          aria-invalid={Boolean(fieldErrors.timezone)}
          className="clay-field h-11 w-full rounded-clay border-0 bg-background px-3.5 text-sm outline-none"
        >
          {timezone === "" ? (
            <option value="">Choose a timezone</option>
          ) : null}
          {!timezoneOptions.some((option) => option.value === timezone) && timezone ? (
            <option value={timezone}>{timezone} — current</option>
          ) : null}
          {timezoneOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldError id="timezone-error" message={fieldErrors.timezone} />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11 w-full text-sm">
        {submitting ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
