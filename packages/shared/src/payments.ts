import { z } from "zod";

// ---------------------------------------------------------------------------
// Payment statuses (M4).
// The Prisma `PaymentStatus` enum mirrors this list. Terminal statuses
// (EXPIRED, REVERSED, USED) release the user: a new payment may start and the
// tier may be re-chosen. Non-terminal statuses keep the money in play, so a
// user has at most one such payment (partial unique index in the DB) and may
// not switch tiers until it is resolved.
// ---------------------------------------------------------------------------

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  UNDERPAID: "UNDERPAID",
  OVERPAID: "OVERPAID",
  EXPIRED: "EXPIRED",
  REVERSED: "REVERSED",
  FLAGGED: "FLAGGED",
  USED: "USED",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const NON_TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.CONFIRMED,
  PAYMENT_STATUS.UNDERPAID,
  PAYMENT_STATUS.OVERPAID,
  PAYMENT_STATUS.FLAGGED,
];

export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PAYMENT_STATUS.EXPIRED,
  PAYMENT_STATUS.REVERSED,
  PAYMENT_STATUS.USED,
];

// ---------------------------------------------------------------------------

export const PAYMENT_PURPOSE = {
  TIER_ACTIVATION: "TIER_ACTIVATION",
  // Reserved for the later withdrawal feature; never written yet.
  WITHDRAWAL_VERIFICATION: "WITHDRAWAL_VERIFICATION",
} as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSE)[keyof typeof PAYMENT_PURPOSE];

export const PAYMENT_PROVIDERS = ["fake"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

// Currency of every tier price and expected amount. Naira, whole kobo.
export const PAYMENT_CURRENCY = "NGN" as const;

// ---------------------------------------------------------------------------
// Settings (single source of truth for web, bot and server)
// ---------------------------------------------------------------------------

/** How long a generated account accepts the transfer (default 60 minutes). */
export const PAYMENT_WINDOW_MINUTES = 60;
export const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_MINUTES * 60 * 1000;

export const PIN_LENGTH = 6;
export const PIN_LIFETIME_MINUTES = 10;
export const PIN_LIFETIME_MS = PIN_LIFETIME_MINUTES * 60 * 1000;
/** Wrong attempts before the pin row is LOCKED. Counted in the database. */
export const PIN_MAX_WRONG_ATTEMPTS = 5;
/** New pins per payment; asking again invalidates the previous pin. */
export const PIN_MAX_ISSUES_PER_PAYMENT = 3;

export const LINK_KEY_MAX_LENGTH = 64;
export const LINK_KEY_LIFETIME_MINUTES = 10;
export const LINK_KEY_LIFETIME_MS = LINK_KEY_LIFETIME_MINUTES * 60 * 1000;
// Deep-link key charset: letters, digits, underscore, hyphen only.
export const LINK_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Money: whole kobo in, displayed naira out. Every conversion funnels through
// these two helpers so naira/kobo never drifts between web, bot and server.
// ---------------------------------------------------------------------------

/** 200000 kobo -> 2000 naira. */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** 200000 kobo -> "₦2,000.00". */
export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Request schemas. Like every other M-series schema these accept only the
// facts the server cannot compute itself; price, tier, status, amount,
// account and role fields in a body are stripped and ignored. POST /payments/
// start sends an empty object (tier and price come from selectedTier);
// /payments/pin and /payments/activate send the pin only.
// ---------------------------------------------------------------------------

export const paymentStartSchema = z.object({});

export const paymentPinSchema = z.object({
  pin: z
    .string()
    .trim()
    .max(PIN_LENGTH, `Enter your ${PIN_LENGTH}-digit PIN.`)
    .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `Enter your ${PIN_LENGTH}-digit PIN.`),
});

export const paymentLinkSchema = z.object({});

// ---------------------------------------------------------------------------
// Next-step wording per payment status (web and bot use the same strings).
// The shortfall figure is interpolated server-side via `paymentNextStep` so
// the text and the money can never disagree.
// ---------------------------------------------------------------------------

export const PAYMENT_NEXT_STEP: Record<PaymentStatus, string> = {
  PENDING: "Transfer the exact amount to the account shown.",
  CONFIRMED: "Get your activation PIN, then activate.",
  UNDERPAID: "Send the shortfall to the same account before it expires.",
  OVERPAID: "Your payment is confirmed; the excess will be refunded. Activate to continue.",
  EXPIRED: "Start a new payment.",
  REVERSED: "Start a new payment.",
  FLAGGED: "Our team is reviewing your payment. Support will reach out.",
  USED: "Your tier is active.",
};

export function paymentNextStep(status: PaymentStatus, shortfallKobo?: number | null): string {
  const text = PAYMENT_NEXT_STEP[status];
  if (
    status === PAYMENT_STATUS.UNDERPAID &&
    shortfallKobo !== undefined &&
    shortfallKobo !== null &&
    shortfallKobo > 0
  ) {
    return `Send ${formatNaira(shortfallKobo)} more to the same account before it expires.`;
  }
  return text;
}
