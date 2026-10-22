import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";

import { ENV } from "@/env.server";
import type {
    CreateAccountInput,
    CreateAccountResult,
    NotificationIdentity,
    PaymentProviderAdapter,
    ProviderTransactionType,
    VerifiedTransaction,
} from "./types";

// ---------------------------------------------------------------------------
// Development-only fake provider.
//
// It exists so every payment path (start, webhook, pin, activation, bot) can
// be exercised without a real provider. It is FORBIDDEN outside development:
// the constructor throws, and the server boot refuses it earlier still.
//
// Its "authoritative data" is a small gitignored JSON ledger
// (apps/server/.devpay-ledger.json) that the dev simulate script writes,
// standing in for the provider's own transaction records. verifyTransaction
// reads the ledger; verifyNotification checks an HMAC signature over the
// raw webhook body exactly like a real provider.
//
// Falls back to a fixed dev signing secret when the env var is unset, which
// is safe only because the adapter itself is development-gated.
// ---------------------------------------------------------------------------

const DEV_FALLBACK_WEBHOOK_SECRET = "dev-fake-webhook-signing-key";
export const FAKE_SIGNATURE_HEADER = "x-fakepay-signature";

interface LedgerEntry {
    providerTxRef: string;
    accountReference: string;
    type: ProviderTransactionType;
    amountKobo: number;
    currency: string;
    createdAt: string;
}

interface LedgerFile {
    version: 1;
    entries: LedgerEntry[];
}

const EMPTY_LEDGER: LedgerFile = { version: 1, entries: [] };

export class FakeProviderOutsideDevelopmentError extends Error {
    constructor() {
        super("The fake payment provider may only run in development.");
    }
}

function ledgerPath(): string {
    return path.join(process.cwd(), ".devpay-ledger.json");
}

function readLedger(): LedgerFile {
    try {
        const raw = fs.readFileSync(ledgerPath(), "utf8");
        const parsed = JSON.parse(raw) as Partial<LedgerFile>;
        if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return EMPTY_LEDGER;
        return { version: 1, entries: parsed.entries as LedgerEntry[] };
    } catch {
        return EMPTY_LEDGER;
    }
}

function writeLedger(ledger: LedgerFile): void {
    fs.writeFileSync(ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/** Stable, display-only fake account number derived from the reference. */
export function fakeAccountNumberFor(reference: string): string {
    const digest = crypto.createHash("sha256").update(`fake-acct:${reference}`).digest("hex");
    // Uniform over 0..9,999,999,999, zero-padded to exactly 10 digits like a
    // Nigerian bank account number.
    return (parseInt(digest.slice(0, 12), 16) % 10_000_000_000)
        .toString()
        .padStart(10, "0");
}

export function fakeSigningSecret(): string {
    // @internal env keys are not part of the generated ENV types; dev scripts
    // read them from process.env the same way (see DEV_SEED_* usage).
    const configured = process.env.PAYMENT_FAKE_WEBHOOK_SECRET;
    return configured && configured.length > 0 ? configured : DEV_FALLBACK_WEBHOOK_SECRET;
}

/** HMAC over the exact raw body, compared in constant time. */
function bodyAuthentic(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = fakeSignatureFor(rawBody);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** What the dev simulate script signs; verified by bodyAuthentic on arrival. */
export function fakeSignatureFor(rawBody: string): string {
    return crypto.createHmac("sha256", fakeSigningSecret()).update(rawBody).digest("hex");
}

interface SimulateCreditInput {
    accountReference: string;
    type?: ProviderTransactionType;
    amountKobo: number;
    currency?: string;
    providerTxRef?: string;
}

/**
 * What the dev script calls when it pretends money hit the fake account:
 * writes the provider-side ledger entry and returns the transaction
 * reference the notification will carry.
 */
export function recordSimulatedTransaction(input: SimulateCreditInput) {
    const ledger = readLedger();
    const entry: LedgerEntry = {
        providerTxRef: input.providerTxRef ?? crypto.randomBytes(12).toString("hex"),
        accountReference: input.accountReference,
        type: input.type ?? "credit",
        amountKobo: input.amountKobo,
        currency: input.currency ?? "NGN",
        createdAt: new Date().toISOString(),
    };
    writeLedger({ version: 1, entries: [...ledger.entries, entry] });
    return { providerTxRef: entry.providerTxRef };
}

export class FakePaymentProvider implements PaymentProviderAdapter {
    readonly name = "fake" as const;

    constructor() {
        if (ENV.NODE_ENV !== "development") {
            throw new FakeProviderOutsideDevelopmentError();
        }
    }

    async createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
        return {
            accountReference: input.reference,
            bankName: "PromptPaid Sandbox Bank",
            accountName: "PromptPaid Dev Collections",
            accountNumber: fakeAccountNumberFor(input.reference),
        };
    }

    async verifyTransaction(providerTxRef: string): Promise<VerifiedTransaction | null> {
        const entry = readLedger().entries.find((candidate) => candidate.providerTxRef === providerTxRef);
        if (!entry) return null;
        return {
            providerTxRef: entry.providerTxRef,
            accountReference: entry.accountReference,
            type: entry.type,
            amountKobo: entry.amountKobo,
            currency: entry.currency,
        };
    }

    async verifyNotification(
        rawBody: string,
        headers: Record<string, string | undefined>,
    ): Promise<NotificationIdentity> {
        const signature = headers[FAKE_SIGNATURE_HEADER];
        if (!bodyAuthentic(rawBody, signature)) {
            return { authentic: false, rejectionReason: "bad_signature" };
        }
        try {
            const parsed = JSON.parse(rawBody) as { providerTxRef?: unknown };
            if (typeof parsed.providerTxRef !== "string" || parsed.providerTxRef.length === 0) {
                return { authentic: false, rejectionReason: "missing_provider_tx_ref" };
            }
            return { authentic: true, providerTxRef: parsed.providerTxRef };
        } catch {
            return { authentic: false, rejectionReason: "unparsable_body" };
        }
    }
}
