import type { PaymentProvider } from "@promptpaid/shared";

// ---------------------------------------------------------------------------
// The single adapter boundary every consumer (service, dev script) goes
// through. One adapter per configured provider; the only implementation
// today is the development-only fake. The real provider plugs in here
// without touching call sites.
// ---------------------------------------------------------------------------

/** Display facts for a generated virtual account. */
export interface ProviderAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface CreateAccountInput {
  /**
   * The reference the generated account is known by (server-generated,
   * unique, stored as Payment.accountReference). Notifications carry it back
   * so a credit can be matched to exactly one payment.
   */
  reference: string;
  /** Whole kobo this account is expected to receive. */
  expectedAmountKobo: number;
}

export interface CreateAccountResult extends ProviderAccount {
  accountReference: string;
}

/** The kind of money movement the provider reports for a transaction. */
export type ProviderTransactionType = "credit" | "reversal";

/**
 * Authoritative facts about one transaction, straight from the provider.
 * The webhook handler never trusts a notification payload's amounts: this
 * verify call is the confirmation step, and only its numbers may be checked
 * against a payment's expected kobo amount.
 */
export interface VerifiedTransaction {
  providerTxRef: string;
  accountReference: string;
  type: ProviderTransactionType;
  amountKobo: number;
  currency: string;
}

/**
 * Authentication + routing facts of one webhook request. Deliberately
 * excludes amounts: handlers confirm those through verifyTransaction.
 */
export interface NotificationIdentity {
  authentic: boolean;
  /** Stable internal reason for a rejection; never echoes payload text. */
  rejectionReason?: string;
  /** The provider's transaction reference inside the notification. */
  providerTxRef?: string;
}

export interface PaymentProviderAdapter {
  readonly name: PaymentProvider | string;

  /** Create the generated account a payment will display to the user. */
  createAccount(input: CreateAccountInput): Promise<CreateAccountResult>;

  /** The authoritative source for one transaction's facts, or null if unused. */
  verifyTransaction(providerTxRef: string): Promise<VerifiedTransaction | null>;

  /** Verify authenticity of a webhook request and extract routing facts. */
  verifyNotification(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<NotificationIdentity>;
}
