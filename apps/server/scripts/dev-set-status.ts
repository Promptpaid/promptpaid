/**
 * Dev-only helper to move a test account to a chosen onboarding (and optionally
 * account) status, so later stories (screening, tier, payment) can be exercised
 * without walking the whole journey.
 *
 * Safety rails:
 *   - refuses to run unless NODE_ENV is exactly "development"
 *   - refuses to run unless the database host is in DEV_SEED_ALLOWED_HOSTS
 *     (comma-separated); an empty/unset list fails closed
 *   - prints only the database host and name (never the URL or password)
 *
 * Usage:
 *   pnpm -F server dev:set-status <email> <onboardingStatus> [userStatus]
 *
 * Example:
 *   pnpm -F server dev:set-status trainer@example.com SCREENING_IN_PROGRESS
 *   pnpm -F server dev:set-status trainer@example.com ACTIVATED ACTIVE
 */
import { ONBOARDING_STATUS, USER_STATUS } from "@promptpaid/shared";
import { ENV } from "../src/env.server";
import { db } from "../src/services";

function fail(message: string): never {
    console.error(`dev-set-status: ${message}`);
    process.exit(1);
}

const onboardingValues = Object.values(ONBOARDING_STATUS);
const userValues = Object.values(USER_STATUS);

const [emailArg, onboardingArg, userArg] = process.argv.slice(2);

if (ENV.NODE_ENV !== "development") {
    fail(`refusing to run outside development (NODE_ENV=${ENV.NODE_ENV}).`);
}

const url = new URL(ENV.DATABASE_URL);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

const allowedHosts = (process.env.DEV_SEED_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

if (allowedHosts.length === 0) {
    fail("set DEV_SEED_ALLOWED_HOSTS (comma-separated) to authorize writes to this database.");
}
if (!allowedHosts.includes(host)) {
    fail(`host ${host} is not in DEV_SEED_ALLOWED_HOSTS.`);
}

console.log(`dev-set-status: host=${host} database=${database}`);

if (!emailArg) {
    fail("usage: dev:set-status <email> <onboardingStatus> [userStatus]");
}

const onboardingStatus = onboardingValues.find(
    (value) => value === onboardingArg?.toUpperCase(),
);
if (!onboardingStatus) {
    fail(`onboardingStatus must be one of: ${onboardingValues.join(", ")}`);
}

const userStatus = userArg
    ? userValues.find((value) => value === userArg.toUpperCase())
    : undefined;
if (userArg && !userStatus) {
    fail(`userStatus must be one of: ${userValues.join(", ")}`);
}

const result = await db.user.updateMany({
    where: { email: emailArg.trim().toLowerCase() },
    data: {
        onboardingStatus,
        ...(userStatus ? { status: userStatus } : {}),
    },
});

await db.$disconnect();

if (result.count === 0) {
    fail(`no user found with email ${emailArg}`);
}

console.log(
    `updated ${result.count} user(s): ${emailArg} -> onboarding=${onboardingStatus}` +
        (userStatus ? ` user=${userStatus}` : ""),
);
