/**
 * Dev-only helper to remove loaded screening questions and passages.
 *
 * SAME safety rails as scripts/load-questions.ts:
 *   - refuses to run unless NODE_ENV is exactly "development"
 *   - refuses unless the database host is in DEV_SEED_ALLOWED_HOSTS
 *     AND the database name is in DEV_SEED_ALLOWED_DATABASES
 *   - prints only the database host and name (never the URL or password)
 *
 * Refusal rule: if ANY question is referenced by an existing attempt
 * (AttemptQuestion rows exist), the script deletes NOTHING and exits 1.
 * Attempt history must never be orphaned or rewritten.
 *
 * Prints counts only (no prompts, options, answers or text).
 *
 * Usage:
 *   DEV_SEED_ALLOWED_HOSTS=<host> DEV_SEED_ALLOWED_DATABASES=<db> \
 *     pnpm -F server dev:clear-questions
 */
import { ENV } from "../src/env.server";
import { db } from "../src/services";

function fail(message: string): never {
    console.error(`clear-questions: ${message}`);
    process.exit(1);
}

if (ENV.NODE_ENV !== "development") {
    fail(`refusing to run outside development (NODE_ENV=${ENV.NODE_ENV}).`);
}

const url = new URL(ENV.DATABASE_URL);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] ?? "");

console.log(`clear-questions: host=${host} database=${database}`);

const allowedHosts = (process.env.DEV_SEED_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
const allowedDatabases = (process.env.DEV_SEED_ALLOWED_DATABASES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

if (allowedHosts.length === 0) {
    fail("set DEV_SEED_ALLOWED_HOSTS (comma-separated) to authorize writes to this database.");
}
if (allowedDatabases.length === 0) {
    fail("set DEV_SEED_ALLOWED_DATABASES (comma-separated) to authorize writes to this database.");
}
if (!allowedHosts.includes(host)) {
    fail(`host ${host} is not in DEV_SEED_ALLOWED_HOSTS.`);
}
if (!allowedDatabases.includes(database)) {
    fail(`database ${database} is not in DEV_SEED_ALLOWED_DATABASES.`);
}

const referenced = await db.attemptQuestion.count();
if (referenced > 0) {
    fail(
        `${referenced} bank question(s) are referenced by existing attempts, deleting nothing. ` +
            `Attempts are permanent; clear them first in Studio only if you accept losing history.`,
    );
}

const [answers, attemptQuestions, questions, passages] = await db.$transaction(
    async (tx) => [
        (await tx.answer.deleteMany()).count,
        (await tx.attemptQuestion.deleteMany()).count,
        (await tx.question.deleteMany()).count,
        (await tx.passage.deleteMany()).count,
    ],
    { timeout: 30000 },
);

await db.$disconnect();

console.log(
    `deleted ${questions} question(s), ${passages} passage(s), ` +
        `${attemptQuestions} attempt question(s), ${answers} answer(s).`,
);
