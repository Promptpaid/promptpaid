import { z } from "zod";

export const CONSENT_VERSION = "2026-01";

export const WAITLIST_COUNTRIES = ["NG", "ZA", "GH", "KE"] as const;

export const WAITLIST_LANGUAGES = [
  "english",
  "pidgin",
  "yoruba",
  "igbo",
  "hausa",
  "afrikaans",
  "zulu",
  "swahili",
  "french",
] as const;

export const waitlistSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address")),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{8,15}$/, "Phone must be in international format, e.g. +2348012345678"),
  country: z.enum(WAITLIST_COUNTRIES),
  languages: z.array(z.enum(WAITLIST_LANGUAGES)).min(1).max(9),
  interests: z.array(z.string().max(40)).max(10).default([]),
  consent: z.literal(true, { error: "You must agree to the terms to join" }),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
