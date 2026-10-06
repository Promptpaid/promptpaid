import { z } from "zod";
import { WAITLIST_LANGUAGES } from "./waitlist";


export const COUNTRIES = ["NG", "ZA", "GH", "KE"] as const;


export const signUpSchema = z.object({
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
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    country: z.enum(COUNTRIES),
    languages: z.array(z.enum(WAITLIST_LANGUAGES)).min(1).max(9),
})

export type SignupInput = z.infer<typeof signUpSchema>;