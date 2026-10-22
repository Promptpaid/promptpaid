import {
    PAYMENT_CURRENCY,
    PAYMENT_STATUS,
    type PaymentStatus,
} from "@promptpaid/shared";

// ---------------------------------------------------------------------------
// The policy table, as a pure function so web, bot and future tests share
// exactly one implementation. Inputs are only DB facts plus provider-verified
// transaction facts — nothing from a notification payload's own numbers.
//
// Exactly amount required. Underpaid: do not confirm, report the shortfall,
// allow a top-up to the same account until expiry. Overpaid: confirm and
// flag the excess for manual refund. Credit after expiry: do not
// auto-confirm, set FLAGGED. Second credit for the same payment: FLAGGED for
// refund. Wrong currency: FLAGGED. Reversal after activation: freeze the
// user, delete their sessions, FLAGGED.
// ---------------------------------------------------------------------------

export interface VerifiedCredit {
  providerTxRef: string;
  type: "credit" | "reversal";
  amountKobo: number;
  currency: string;
}

export interface PaymentPolicyRow {
  id: string;
  userId: string;
  status: PaymentStatus;
  expectedAmountKobo: number;
  paidAmountKobo: number | null;
  expiresAt: Date;
}

export type CreditEventReason =
  | "credit_confirmed"
  | "topup_underpaid"
  | "overpaid_excess_refund"
  | "late_credit_after_expiry"
  | "second_credit_for_refund"
  | "credit_after_activation_refund"
  | "wrong_currency_refund"
  | "payment_reversed"
  | "reversal_after_activation_freeze"
  | "credit_on_flagged_ignored";

export interface CreditOutcome {
  /** The conditional updateMany's source statuses (`from` = {in}). */
  from: readonly PaymentStatus[];
  /** Extra equality the update must still satisfy (late-credit race guard). */
  expiresAtBefore?: Date;
  to?: PaymentStatus;
  paidAmountKobo?: number;
  confirmedAt?: boolean;
  flaggedReason?: string;
  /** Take and record the provider's transaction reference on first credit. */
  setProviderTxRef?: boolean;
  /** Reversal after activation: freeze the account (with session deletion). */
  freeze?: boolean;
  reason: CreditEventReason;
}

function flag(outcome: Omit<CreditOutcome, "reason">, reason: CreditEventReason): CreditOutcome {
  return { ...outcome, reason };
}

/**
 * Pure decision for one provider-verified movement against one payment row.
 * Callers run the returned conditional update inside a short transaction and
 * react to the affected count.
 */
export function applyCreditPolicy(
  payment: PaymentPolicyRow,
  credit: VerifiedCredit,
  now: Date = new Date(),
): CreditOutcome {
  const { status } = payment;
  const expired = payment.expiresAt.getTime() < now.getTime();

  if (credit.type === "reversal") {
    if (status === PAYMENT_STATUS.USED) {
      return flag(
        { from: [PAYMENT_STATUS.USED], to: PAYMENT_STATUS.FLAGGED, freeze: true },
        "reversal_after_activation_freeze",
      );
    }
    if (status === PAYMENT_STATUS.REVERSED) {
      // Already fully reversed: nothing more to take back.
      return flag({ from: [PAYMENT_STATUS.REVERSED] }, "credit_on_flagged_ignored");
    }
    return flag(
      { from: [status], to: PAYMENT_STATUS.REVERSED, paidAmountKobo: 0 },
      "payment_reversed",
    );
  }

  if (credit.currency !== PAYMENT_CURRENCY) {
    // Wrong currency: FLAGGED (money cannot be matched against kobo).
    return flag(
      { from: [status], to: PAYMENT_STATUS.FLAGGED },
      "wrong_currency_refund",
    );
  }

  if (status === PAYMENT_STATUS.CONFIRMED || status === PAYMENT_STATUS.OVERPAID) {
    // Second credit for the same payment: FLAGGED for refund. The paid
    // bookkeeping keeps the first credit's total; the event carries the rest.
    return flag(
      { from: [status], to: PAYMENT_STATUS.FLAGGED },
      "second_credit_for_refund",
    );
  }

  if (status === PAYMENT_STATUS.USED) {
    return flag(
      { from: [PAYMENT_STATUS.USED], to: PAYMENT_STATUS.FLAGGED },
      "credit_after_activation_refund",
    );
  }

  if (expired && (status === PAYMENT_STATUS.PENDING || status === PAYMENT_STATUS.UNDERPAID)) {
    // Credit after expiry: never auto-confirm, set FLAGGED. The expiry
    // condition is part of the conditional update, so a webhook racing a
    // start-and-expire cannot flip a payment that just got confirmed.
    return flag(
      {
        from: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.UNDERPAID],
        to: PAYMENT_STATUS.FLAGGED,
        paidAmountKobo: (payment.paidAmountKobo ?? 0) + credit.amountKobo,
        expiresAtBefore: payment.expiresAt,
      },
      "late_credit_after_expiry",
    );
  }

  if (
    status === PAYMENT_STATUS.EXPIRED ||
    status === PAYMENT_STATUS.REVERSED ||
    status === PAYMENT_STATUS.FLAGGED
  ) {
    // Terminal-ish rows do not move on credits; ops reconciles manually.
    return flag({ from: [status] }, "credit_on_flagged_ignored");
  }

  // PENDING/UNDERPAID within the window: accumulate and decide.
  const paid = (payment.paidAmountKobo ?? 0) + credit.amountKobo;
  const base = {
    from: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.UNDERPAID] as const,
    paidAmountKobo: paid,
  };

  if (paid === payment.expectedAmountKobo) {
    return flag(
      { ...base, to: PAYMENT_STATUS.CONFIRMED, confirmedAt: true, setProviderTxRef: true },
      "credit_confirmed",
    );
  }
  if (paid < payment.expectedAmountKobo) {
    return flag({ ...base, to: PAYMENT_STATUS.UNDERPAID }, "topup_underpaid");
  }
  return flag(
    {
      ...base,
      to: PAYMENT_STATUS.OVERPAID,
      confirmedAt: true,
      setProviderTxRef: true,
      flaggedReason: `excess_${paid - payment.expectedAmountKobo}kobo_pending_manual_refund`,
    },
    "overpaid_excess_refund",
  );
}

/** kobo the user still owes on an open payment; 0 when confirmed/paid up. */
export function shortfallKoboOf(payment: {
  status: PaymentStatus;
  expectedAmountKobo: number;
  paidAmountKobo: number | null;
}): number | null {
  if (payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.UNDERPAID) {
    return null;
  }
  const shortfall = payment.expectedAmountKobo - (payment.paidAmountKobo ?? 0);
  return shortfall > 0 ? shortfall : null;
}
