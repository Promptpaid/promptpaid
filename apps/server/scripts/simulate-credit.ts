/**
 * Dev-only simulation of a bank-transfer credit landing on a payment's
 * generated account at the FAKE provider. It writes the fake provider's
 * ledger (the provider's own authoritative record) and then POSTs the
 * signed webhook notification to the running server, so the full pipeline
 * is exercised: signature check -> PaymentEvent -> adapter verify -> policy.
 *
 * Safety rails (mirrors scripts/load-questions.ts):
 *   - refuses to run unless NODE_ENV is exactly "development"
 *   - refuses unless the database host is in DEV_SEED_ALLOWED_HOSTS
 *     (comma-separated) AND the database name is in DEV_SEED_ALLOWED_DATABASES
 *     (comma-separated); empty/unset lists fail closed
 *   - prints only the database host and name, internal ids and outcomes
 *     (never the backend URL, secrets, or account numbers)
 *
 * Starts the server first: pnpm dev:server (the script POSTs to it).
 *
 * Usage:
 *   DEV_SEED_ALLOWED_HOSTS=<host> DEV_SEED_ALLOWED_DATABASES=<db> \
 *     pnpm -F server dev:simulate-credit <accountReference> <amountNaira> \
 *       [--reverse] [--txRef <providerTxRef>] [serverBaseUrl]
 *
 * Examples:
 *   pnpm -F server dev:simulate-credit 9f2c...ab 2000            (exact pay)
 *   pnpm -F server dev:simulate-credit 9f2c...ab 500             (underpay)
 *   pnpm -F server dev:simulate-credit 9f2c...ab 2500            (overpay)
 *   pnpm -F server dev:simulate-credit 9f2c...ab 2000 --txRef X  (duplicate)
 *   pnpm -F server dev:simulate-credit 9f2c...ab 100 --reverse   (reversal)
 */
import { ENV } from "../src/env.server";

function fail(message: string): never {
    console.error(`simulate-credit: ${message}`);
    process.exit(1);
}

const args = process.argv.slice(2);

if (ENV.NODE_ENV !== "development") {
    fail(`refusing to run outside development (NODE_ENV=${ENV.NODE_ENV}).`);
}

const url = new URL(ENV.DATABASE_URL);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] ?? "");

console.log(`simulate-credit: host=${host} database=${database}`);

const allowedHosts = (process.env.DEV_SEED_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
const allowedDatabases = (process.env.DEV_SEED_ALLOWED_DATABASES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

if (allowedHosts.length === 0) {
    fail("set DEV_SEED_ALLOWED_HOSTS (comma-separated) to authorize this script.");
}
if (!allowedHosts.includes(host)) {
    fail(`host ${host} is not in DEV_SEED_ALLOWED_HOSTS.`);
}
if (allowedDatabases.length === 0) {
    fail("set DEV_SEED_ALLOWED_DATABASES (comma-separated) to authorize this script.");
}
if (!allowedDatabases.includes(database)) {
    fail(`database ${database} is not in DEV_SEED_ALLOWED_DATABASES.`);
}

let reverse = false;
let forcedTxRef: string | undefined;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--reverse") {
        reverse = true;
    } else if (arg === "--txRef") {
        const next = args[i + 1];
        if (!next || next.startsWith("--")) {
            fail("--txRef requires the provider transaction reference to reuse.");
        }
        forcedTxRef = next;
        i++;
    } else {
        positional.push(arg);
    }
}

const [accountReference, amountArg, baseUrlArg] = positional;

if (!accountReference || !amountArg) {
    fail("usage: dev:simulate-credit <accountReference> <amountNaira> [--reverse] [--txRef X] [base]");
}

// Naira -> whole kobo. The script rejects any amount that is not an exact
// number of kobo, so the ledger can only contain integer kobo like the
// database and the money helpers in @promptpaid/shared.
const naira = Number(amountArg);
if (!Number.isFinite(naira) || naira < 0) {
    fail(`amount "${amountArg}" is not a non-negative naira amount.`);
}
const koboExact = naira * 100;
if (Math.abs(koboExact - Math.round(koboExact)) > 1e-9) {
    fail(`amount "${amountArg}" does not convert to whole kobo.`);
}
const amountKobo = Math.round(koboExact);

// Late imports: the fake provider module throws outside development, so all
// guards above must have passed first.
const { recordSimulatedTransaction, fakeSignatureFor, FAKE_SIGNATURE_HEADER } = await import(
    "../src/module/payments/provider/fake"
);

const recorded = recordSimulatedTransaction({
    accountReference,
    type: reverse ? "reversal" : "credit",
    amountKobo,
    currency: "NGN",
    providerTxRef: forcedTxRef,
});

if (forcedTxRef) {
    console.log(`simulate-credit: note=forced_tx_ref txRef=${recorded.providerTxRef}`);
}

const body = JSON.stringify({ providerTxRef: recorded.providerTxRef });
const signature = fakeSignatureFor(body);
const baseUrl = baseUrlArg?.replace(/\/+$/, "") ?? "http://localhost:3000";

const response = await fetch(`${baseUrl}/webhooks/payments`, {
    method: "POST",
    headers: {
        "content-type": "application/json",
        [FAKE_SIGNATURE_HEADER]: signature,
    },
    body,
});

let summary = "unreadable";
try {
    const parsed = (await response.json()) as { status?: string; outcome?: string };
    summary = `${parsed.status ?? "unknown"}${parsed.outcome ? `/${parsed.outcome}` : ""}`;
} catch {
    summary = `http_${response.status}`;
}

console.log(
    `simulate-credit: outcome=${summary} txRef=${recorded.providerTxRef}` +
        ` type=${reverse ? "reversal" : "credit"} amountKobo=${amountKobo}`,
);
process.exit(response.ok ? 0 : 1);
