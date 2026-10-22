import crypto from "crypto";

import {
    PAYMENT_STATUS,
    PAYMENT_WINDOW_MS,
    TIERS,
    USER_STATUS,
    paymentNextStep,
    type OnboardingStatus,
    type PaymentStatus,
    type UserStatus,
} from "@promptpaid/shared";

import { db } from "@/services";
import { getOnboardingProfile } from "@/module/onboarding/repo";
import {
    deleteUserSessions,
    setAccountStatus,
} from "@/module/auth/repo";
import { paymentProvider } from "./provider";
import {
    createPayment,
    expireStalePayment,
    findHandledPaymentEvent,
    findLatestPaymentForUser,
    findOpenPaymentForUser,
    insertPaymentEvent,
    isUniqueViolation,
    rawBodyEventReference,
} from "./repo";
import {
    applyCreditPolicy,
    shortfallKoboOf,
    type CreditOutcome,
    type PaymentPolicyRow,
    type VerifiedCredit,
} from "./policy";
import { canStartPayment, wrongStatusReply, type AccountPosition } from "./status-gate";

const TX_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Public shape shared by /payments/start and /payments/current (and later by
// the bot). Account numbers are display data for the payer; they are never
// logged and never arrive from the client.
// ---------------------------------------------------------------------------

export interface PublicPayment {
    id: string;
    tier: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    /** Whole kobo the user must transfer in total for this payment. */
    amountKobo: number;
    /** Whole kobo still missing while UNDERPAID; null otherwise. */
    shortfallKobo: number | null;
    status: PaymentStatus;
    /** Server-calculated; never taken from the client. */
    secondsRemaining: number;
}

type PaymentRowLike = {
    id: string;
    tier: string;
    status: string;
    expectedAmountKobo: number;
    paidAmountKobo: number | null;
    bankName: string;
    accountName: string;
    accountNumber: string;
    expiresAt: Date;
};

/** Display status: a stale PENDING/UNDERPAID row is shown as EXPIRED. */
function displayStatusOf(payment: PaymentRowLike, nowMs: number): {
    status: PaymentStatus;
    expired: boolean;
} {
    const expired = payment.expiresAt.getTime() < nowMs;
    if (
        expired &&
        (payment.status === PAYMENT_STATUS.PENDING || payment.status === PAYMENT_STATUS.UNDERPAID)
    ) {
        return { status: PAYMENT_STATUS.EXPIRED, expired: true };
    }
    return { status: payment.status as PaymentStatus, expired };
}

export function toPublicPayment(payment: PaymentRowLike, now: Date = new Date()): PublicPayment {
    const { status, expired } = displayStatusOf(payment, now.getTime());
    return {
        id: payment.id,
        tier: payment.tier,
        bankName: payment.bankName,
        accountName: payment.accountName,
        accountNumber: payment.accountNumber,
        amountKobo: payment.expectedAmountKobo,
        shortfallKobo: expired ? null : shortfallKoboOf({
            status: status,
            expectedAmountKobo: payment.expectedAmountKobo,
            paidAmountKobo: payment.paidAmountKobo,
        }),
        status,
        secondsRemaining: expired ? 0 : Math.max(0, Math.floor((payment.expiresAt.getTime() - now.getTime()) / 1000)),
    };
}

function nextStepForPayment(status: PaymentStatus, shortfallKobo: number | null): string {
    return paymentNextStep(status, shortfallKobo);
}

// ---------------------------------------------------------------------------
// Start a payment (web page and bot call the same function). Safe to repeat:
// an open payment is returned as-is; a stale one is expired first by a
// conditional update in case a webhook already promoted it.
// ---------------------------------------------------------------------------

export interface StartPaymentInput {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}

export type StartPaymentResult =
    | { status: "wrong_status"; httpStatus: 409; body: ReturnType<typeof wrongStatusReply>["body"] }
    | { status: "no_tier"; httpStatus: 409; body: { status: "no_tier"; message: string; nextStep: string } }
    | {
          status: "ok";
          repeated: boolean;
          payment: PublicPayment;
          nextStep: string;
      };

async function snapshotForOpenPayment(
    userId: string,
    position: AccountPosition,
): Promise<StartPaymentResult> {
    const open = await findOpenPaymentForUser(userId);
    if (!open) {
        // The open payment vanished between the check and here; treat like a
        // wrong status so the caller re-reads the journey instead of guessing.
        return { status: "wrong_status", httpStatus: 409, body: wrongStatusReply(position).body };
    }
    const payment = toPublicPayment(open);
    return {
        status: "ok",
        repeated: true,
        payment,
        nextStep: nextStepForPayment(payment.status, payment.shortfallKobo),
    };
}

export async function startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
    const position = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canStartPayment(position)) {
        return { status: "wrong_status", httpStatus: 409, body: wrongStatusReply(position).body };
    }

    // Fresh read: the session snapshot may be stale.
    const user = await getOnboardingProfile(input.userId);
    if (!user) {
        return { status: "wrong_status", httpStatus: 409, body: wrongStatusReply(position).body };
    }
    const freshPosition: AccountPosition = {
        accountStatus: user.status as UserStatus,
        onboardingStatus: user.onboardingStatus as OnboardingStatus,
    };
    if (!canStartPayment(freshPosition)) {
        return { status: "wrong_status", httpStatus: 409, body: wrongStatusReply(freshPosition).body };
    }

    // Promise conveys only the tier the user picked; the price is looked up
    // server-side from TIERS and stored whole kobo. Nothing about money,
    // tier, or status is ever accepted from the client.
    const tier = user.selectedTier;
    if (!tier) {
        return {
            status: "no_tier",
            httpStatus: 409,
            body: {
                status: "no_tier",
                message: "Pick a tier before paying.",
                nextStep: "Choose your tier.",
            },
        };
    }
    const setting = TIERS[tier as keyof typeof TIERS];
    if (!setting.open) {
        return {
            status: "no_tier",
            httpStatus: 409,
            body: {
                status: "no_tier",
                message: "That tier is not open yet.",
                nextStep: "Choose your tier.",
            },
        };
    }

    const now = new Date();

    const existing = await findOpenPaymentForUser(input.userId);
    if (existing) {
        const stale =
            (existing.status === PAYMENT_STATUS.PENDING ||
                existing.status === PAYMENT_STATUS.UNDERPAID) &&
            existing.expiresAt.getTime() < now.getTime();
        if (!stale) {
            const payment = toPublicPayment(existing);
            return {
                status: "ok",
                repeated: true,
                payment,
                nextStep: nextStepForPayment(payment.status, payment.shortfallKobo),
            };
        }
        // Stale PENDING/UNDERPAID: expire it, but only while it is still
        // stale in the database (a concurrent webhook may have confirmed it).
        const { count } = await expireStalePayment(existing.id, now);
        if (count === 0) {
            return await snapshotForOpenPayment(input.userId, freshPosition);
        }
    }

    const accountReference = crypto.randomBytes(16).toString("hex");
    try {
        const provider = paymentProvider();
        const account = await provider.createAccount({
            reference: accountReference,
            expectedAmountKobo: setting.price,
        });
        const payment = await createPayment({
            userId: input.userId,
            tier,
            expectedAmountKobo: setting.price,
            provider: provider.name,
            accountReference: account.accountReference,
            bankName: account.bankName,
            accountName: account.accountName,
            accountNumber: account.accountNumber,
            expiresAt: new Date(now.getTime() + PAYMENT_WINDOW_MS),
        });
        const publicPayment = toPublicPayment(payment);
        return {
            status: "ok",
            repeated: false,
            payment: publicPayment,
            nextStep: nextStepForPayment(publicPayment.status, publicPayment.shortfallKobo),
        };
    } catch (err) {
        if (isUniqueViolation(err)) {
            // The partial unique index fired: another start request won this
            // user's single open slot. Return that payment (two simultaneous
            // starts produce one payment).
            return await snapshotForOpenPayment(input.userId, freshPosition);
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Read the current payment (web page and bot call the same function).
// ---------------------------------------------------------------------------

export interface ReadCurrentPaymentInput {
    userId: string;
}

export type ReadCurrentPaymentResult =
    | {
          status: "none";
          httpStatus: 404;
          body: { status: "none"; message: string; nextStep: string | null };
      }
    | { status: "ok"; payment: PublicPayment; nextStep: string };

export async function readCurrentPayment(
    input: ReadCurrentPaymentInput,
): Promise<ReadCurrentPaymentResult> {
    const user = await getOnboardingProfile(input.userId);
    if (!user || (user.status as UserStatus) !== "ACTIVE") {
        return {
            status: "none",
            httpStatus: 404,
            body: {
                status: "none",
                message: "No payment to show.",
                nextStep: null,
            },
        };
    }

    const latest = await findLatestPaymentForUser(input.userId);
    if (!latest) {
        const position: AccountPosition = {
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        };
        return {
            status: "none",
            httpStatus: 404,
            body: {
                status: "none",
                message: "No payment to show.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    const payment = toPublicPayment(latest);
    return {
        status: "ok",
        payment,
        nextStep: nextStepForPayment(payment.status, payment.shortfallKobo),
    };
}

// ---------------------------------------------------------------------------
// Webhook handling. Order, per the security brief:
//   1. verify authenticity through the adapter (HMAC over the raw body)
//   2. record a PaymentEvent for EVERY request, rejected ones included
//   3. deduplicate on the provider's transaction reference
//   4. confirm the transaction through the adapter's verify call
//   5. match the payment by generated account, check amount + currency,
//      apply the policy table in one short transaction
// The notification payload's own numbers are never trusted: only the
// verifyTransaction facts reach the policy function.
// ---------------------------------------------------------------------------

export interface HandlePaymentsWebhookInput {
    rawBody: string;
    headers: Record<string, string | undefined>;
}

export type HandlePaymentsWebhookResult =
    | { httpStatus: 403; body: { status: "rejected"; message: string } }
    | {
          httpStatus: 200;
          body: {
              status: "ok";
              outcome: "consumed" | "duplicate" | "unmatched" | "no_change";
          };
      };

export async function handlePaymentsWebhook(
    input: HandlePaymentsWebhookInput,
): Promise<HandlePaymentsWebhookResult> {
    const provider = paymentProvider();
    const providerName = provider.name;

    try {
        const identity = await provider.verifyNotification(input.rawBody, input.headers);
        if (!identity.authentic || identity.providerTxRef === undefined) {
            await insertPaymentEvent({
                provider: providerName,
                eventReference: rawBodyEventReference(input.rawBody),
                outcome: "REJECTED",
                reason: identity.rejectionReason ?? "rejected",
            });
            return { httpStatus: 403, body: { status: "rejected", message: "Not accepted." } };
        }
        const providerTxRef = identity.providerTxRef;

        // Repeat notification for a reference that was already consumed (or
        // already observed as a repeat): record this attempt and stop.
        const handled = await findHandledPaymentEvent(providerName, providerTxRef);
        if (handled) {
            await insertPaymentEvent({
                provider: providerName,
                eventReference: providerTxRef,
                outcome: "DUPLICATE",
                reason: `already_${handled.outcome.toLowerCase()}`,
            });
            return { httpStatus: 200, body: { status: "ok", outcome: "duplicate" } };
        }

        // The authoritative confirmation: never the notification's numbers.
        const verified = await provider.verifyTransaction(providerTxRef);
        if (!verified) {
            await insertPaymentEvent({
                provider: providerName,
                eventReference: providerTxRef,
                outcome: "UNMATCHED",
                reason: "no_such_provider_transaction",
            });
            return { httpStatus: 200, body: { status: "ok", outcome: "unmatched" } };
        }

        const credit: VerifiedCredit = {
            providerTxRef: verified.providerTxRef,
            type: verified.type,
            amountKobo: verified.amountKobo,
            currency: verified.currency,
        };

        const outcome = await db.$transaction(
            async (tx) => {
                // Match by the generated account (skip the TX-level where:
                // the account reference is unique and the notification is
                // verified at this point).
                const payment = await tx.payment.findUnique({
                    where: { accountReference: verified.accountReference },
                });
                if (!payment) {
                    await tx.paymentEvent.create({
                        data: {
                            provider: providerName,
                            eventReference: providerTxRef,
                            outcome: "UNMATCHED",
                            reason: "no_payment_for_account_reference",
                        },
                    });
                    return "unmatched" as const;
                }

                const now = new Date();
                const decision: CreditOutcome = applyCreditPolicy(
                    {
                        id: payment.id,
                        userId: payment.userId,
                        status: payment.status as PaymentStatus,
                        expectedAmountKobo: payment.expectedAmountKobo,
                        paidAmountKobo: payment.paidAmountKobo,
                        expiresAt: payment.expiresAt,
                    } satisfies PaymentPolicyRow,
                    credit,
                    now,
                );

                if (decision.to === undefined) {
                    await tx.paymentEvent.create({
                        data: {
                            provider: providerName,
                            eventReference: providerTxRef,
                            outcome: "CONSUMED",
                            reason: decision.reason,
                        },
                    });
                    return "no_change" as const;
                }

                const moved = await tx.payment.updateMany({
                    where: {
                        id: payment.id,
                        status: { in: [...decision.from] },
                        ...(decision.expiresAtBefore !== undefined
                            ? { expiresAt: { lt: decision.expiresAtBefore } }
                            : {}),
                    },
                    data: {
                        status: decision.to,
                        ...(decision.paidAmountKobo !== undefined
                            ? { paidAmountKobo: decision.paidAmountKobo }
                            : {}),
                        ...(decision.confirmedAt ? { confirmedAt: now } : {}),
                        ...(decision.flaggedReason !== undefined
                            ? { flaggedReason: decision.flaggedReason }
                            : {}),
                        ...(decision.setProviderTxRef ? { providerTxRef: verified.providerTxRef } : {}),
                    },
                });

                if (moved.count === 0) {
                    // Something moved the payment first; this delivery is a
                    // repeat from the policy's point of view.
                    await tx.paymentEvent.create({
                        data: {
                            provider: providerName,
                            eventReference: providerTxRef,
                            outcome: "DUPLICATE",
                            reason: "payment_state_changed_concurrently",
                        },
                    });
                    return "duplicate" as const;
                }

                await tx.paymentEvent.create({
                    data: {
                        provider: providerName,
                        eventReference: providerTxRef,
                        outcome: "CONSUMED",
                        reason: decision.reason,
                    },
                });

                if (decision.freeze) {
                    // Reversal after activation: freeze through the single
                    // account-status helper and kill sessions in the same
                    // short transaction as the flag.
                    await setAccountStatus(payment.userId, USER_STATUS.FROZEN, tx);
                    await deleteUserSessions(payment.userId, tx);
                }

                return "consumed" as const;
            },
            { timeout: TX_TIMEOUT_MS },
        );

        return { httpStatus: 200, body: { status: "ok", outcome } };
    } catch (err) {
        // Never lose the event trail: try to record the failure, then surface.
        try {
            await insertPaymentEvent({
                provider: providerName,
                eventReference: rawBodyEventReference(input.rawBody),
                outcome: "FAILED",
                reason: (err as Error).name,
            });
        } catch {
            // The trail write itself failed; the HTTP error code speaks.
        }
        throw err;
    }
}
