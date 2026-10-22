import crypto from "crypto";

import { db } from "@/services";
import type { Database } from "@promptpaid/db";
import {
    NON_TERMINAL_PAYMENT_STATUSES,
    PAYMENT_STATUS,
    type PaymentStatus,
    type TierName,
} from "@promptpaid/shared";

// ---------------------------------------------------------------------------
// Thin payment-row writes. Every status change is a conditional updateMany
// (same pattern as transitionOnboardingStatus): a count of 0 means something
// moved the payment first and the caller must react, not overwrite.
// ---------------------------------------------------------------------------

/** The latest non-terminal payment for a user, any status in the list. */
export async function findOpenPaymentForUser(userId: string) {
    return db.payment.findFirst({
        where: { userId, status: { in: [...NON_TERMINAL_PAYMENT_STATUSES] } },
        orderBy: { createdAt: "desc" },
    });
}

/**
 * The latest payment of any kind (terminal included) so /payments/current
 * can show what happened to an expired or reversed attempt.
 */
export async function findLatestPaymentForUser(userId: string) {
    return db.payment.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
}

export interface TransitionPaymentData {
    to: PaymentStatus;
    paidAmountKobo?: number | null;
    confirmedAt?: Date | null;
    flaggedReason?: string | null;
    providerTxRef?: string;
}

/**
 * Conditional payment status move: only while the row still sits in one of
 * `allowedFrom`. An optional `expiresAtBefore` and `stillBefore` tighten the
 * race windows: the existence of a DB check means a webhook and a
 * payment-start cannot both win over the same state change.
 */
export async function transitionPaymentStatus(
    paymentId: string,
    allowedFrom: readonly PaymentStatus[],
    data: TransitionPaymentData,
    client: Pick<Database, "payment"> = db,
    race?: { expiresAtBefore?: Date; paidAmountKoboEquals?: number },
) {
    const result = await client.payment.updateMany({
        where: {
            id: paymentId,
            status: { in: [...allowedFrom] },
            ...(race?.expiresAtBefore !== undefined ? { expiresAt: { lt: race.expiresAtBefore } } : {}),
            ...(race?.paidAmountKoboEquals !== undefined
                ? { paidAmountKobo: race.paidAmountKoboEquals }
                : {}),
        },
        data: {
            status: data.to,
            ...(data.paidAmountKobo !== undefined ? { paidAmountKobo: data.paidAmountKobo } : {}),
            ...(data.confirmedAt !== undefined ? { confirmedAt: data.confirmedAt } : {}),
            ...(data.flaggedReason !== undefined ? { flaggedReason: data.flaggedReason } : {}),
            ...(data.providerTxRef !== undefined ? { providerTxRef: data.providerTxRef } : {}),
        },
    });
    return { count: result.count };
}

/**
 * Mark a stale payment expired (used when the user starts a replacement).
 * The status guard makes the late-credit path win over the expiry path: if
 * a webhook slipped in first (PENDING -> CONFIRMED/data changed), the count
 * is 0 and the caller re-reads instead of expiring a paid payment.
 */
export async function expireStalePayment(
    paymentId: string,
    now: Date,
    client: Pick<Database, "payment"> = db,
) {
    const result = await client.payment.updateMany({
        where: {
            id: paymentId,
            status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.UNDERPAID] },
            expiresAt: { lt: now },
        },
        data: { status: PAYMENT_STATUS.EXPIRED },
    });
    return { count: result.count };
}

export interface CreatePaymentInput {
    userId: string;
    tier: TierName;
    expectedAmountKobo: number;
    provider: string;
    accountReference: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    expiresAt: Date;
}

/** Fails with Prisma error P2002 when the user already holds an open payment. */
export async function createPayment(input: CreatePaymentInput) {
    return db.payment.create({
        data: {
            userId: input.userId,
            tier: input.tier,
            purpose: "TIER_ACTIVATION",
            expectedAmountKobo: input.expectedAmountKobo,
            provider: input.provider,
            accountReference: input.accountReference,
            bankName: input.bankName,
            accountName: input.accountName,
            accountNumber: input.accountNumber,
            status: PAYMENT_STATUS.PENDING,
            expiresAt: input.expiresAt,
        },
    });
}

export type PaymentRow = NonNullable<
    Awaited<ReturnType<typeof db.payment.findUnique>>
>;

export function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
    );
}

// ---------------------------------------------------------------------------
// PaymentEvent rows: one row per webhook request, accepted or rejected.
// eventReference is the provider's transaction reference for real provider
// events (the dedupe key the notifications are keyed on), or a hash of the
// raw body for requests rejected before a reference could be parsed, so no
// payload text is ever stored.
// ---------------------------------------------------------------------------

export type PaymentEventOutcome = "CONSUMED" | "DUPLICATE" | "REJECTED" | "UNMATCHED" | "FAILED";

export async function insertPaymentEvent(
    input: { provider: string; eventReference: string; outcome: PaymentEventOutcome; reason?: string | null },
    client: Pick<Database, "paymentEvent"> = db,
) {
    return client.paymentEvent.create({
        data: {
            provider: input.provider,
            eventReference: input.eventReference,
            outcome: input.outcome,
            reason: input.reason ?? null,
        },
    });
}

/**
 * Whether a provider reference was already handled (CONSUMED) or already
 * recognized as a repeat (DUPLICATE). DO-not-repeat gate before the adapter
 * verify call; races are still safe because every payment status move is a
 * conditional update that may lose.
 */
export async function findHandledPaymentEvent(provider: string, eventReference: string) {
    return db.paymentEvent.findFirst({
        where: {
            provider,
            eventReference,
            outcome: { in: ["CONSUMED", "DUPLICATE"] },
        },
        orderBy: { receivedAt: "desc" },
    });
}

/** Deterministic reference for rejected notifications: a body hash only. */
export function rawBodyEventReference(rawBody: string): string {
    return `raw:${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}
