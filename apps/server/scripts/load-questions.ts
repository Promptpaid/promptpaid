/**
 * Dev-only loader for the screening question bank.
 *
 * Safety rails (mirrors scripts/dev-set-status.ts):
 *   - refuses to run unless NODE_ENV is exactly "development"
 *   - refuses unless the database host is in DEV_SEED_ALLOWED_HOSTS
 *     (comma-separated) AND the database name is in DEV_SEED_ALLOWED_DATABASES
 *     (comma-separated); empty/unset lists fail closed
 *   - prints only the database host and name (never the URL or password)
 *
 * Validation (all-or-nothing: any failure loads zero rows, and error messages
 * reference row numbers only, never prompts, options, answers or text):
 *   - section and language present and known; CHAT rejected (simulation, not MCQ)
 *   - 2 to 5 unique options, exactly one correctOptionIndex in range
 *   - no duplicate prompts (inside the file, and against the database)
 *   - every READING question linked to a passage key in the same file, with a
 *     matching language; non-READING questions must not carry a passage link
 *
 * Points come from @promptpaid/shared (tenths per section), never from the file.
 *
 * Usage:
 *   DEV_SEED_ALLOWED_HOSTS=<host> DEV_SEED_ALLOWED_DATABASES=<db> \
 *     pnpm -F server dev:load-questions <path/to/bank.json>
 *
 * Example:
 *   DEV_SEED_ALLOWED_HOSTS=ep-xxx-pooler.aws.neon.tech DEV_SEED_ALLOWED_DATABASES=neondb \
 *     pnpm -F server dev:load-questions scripts/screening-sample.json
 */
import fs from "node:fs";
import {
    SCREENING_SECTIONS,
    SCREENING_SECTION,
    WAITLIST_LANGUAGES,
    screeningPointsPerQuestionTenths,
} from "@promptpaid/shared";
import { ENV } from "../src/env.server";
import { db } from "../src/services";

function fail(message: string): never {
    console.error(`load-questions: ${message}`);
    process.exit(1);
}

const [fileArg] = process.argv.slice(2);

if (ENV.NODE_ENV !== "development") {
    fail(`refusing to run outside development (NODE_ENV=${ENV.NODE_ENV}).`);
}

const url = new URL(ENV.DATABASE_URL);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] ?? "");

console.log(`load-questions: host=${host} database=${database}`);

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

if (!fileArg) {
    fail("usage: dev:load-questions <path/to/bank.json>");
}

let raw: unknown;
try {
    raw = JSON.parse(fs.readFileSync(fileArg, "utf8"));
} catch {
    fail(`cannot read or parse ${fileArg}.`);
}

const errors: string[] = [];
const err = (msg: string) => errors.push(msg);

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

const normPrompt = (s: string) => s.trim().toLowerCase();

if (!isRecord(raw)) err("file root must be an object with passages[] and questions[].");

interface PassageRow {
    index: number;
    key: string;
    language: string;
    text: string;
}

interface QuestionRow {
    index: number;
    section: string;
    language: string;
    prompt: string;
    options: string[];
    correctOptionIndex: number;
    passageKey: string | null;
}

const passageRows: PassageRow[] = [];
const questionRows: QuestionRow[] = [];

if (errors.length === 0) {
    const root = raw as Record<string, unknown>;
    const passages = root.passages;
    const questions = root.questions;

    if (!Array.isArray(passages)) err("passages must be an array.");
    if (!Array.isArray(questions) || questions.length === 0) {
        err("questions must be a non-empty array.");
    }

    if (errors.length === 0) {
        const seenKeys = new Set<string>();
        (passages as unknown[]).forEach((p, i) => {
            const n = `passage row ${i}`;
            if (!isRecord(p)) return err(`${n}: must be an object.`);
            const key = typeof p.key === "string" ? p.key.trim() : "";
            const language = typeof p.language === "string" ? p.language.trim() : "";
            const text = typeof p.text === "string" ? p.text.trim() : "";
            if (!key) return err(`${n}: key is required.`);
            if (seenKeys.has(key)) return err(`${n}: duplicate key in file.`);
            seenKeys.add(key);
            if (!(WAITLIST_LANGUAGES as readonly string[]).includes(language)) {
                return err(`${n}: unknown language.`);
            }
            if (text.length < 20) return err(`${n}: text is too short.`);
            passageRows.push({ index: i, key, language, text });
        });

        const seenPrompts = new Set<string>();
        (questions as unknown[]).forEach((q, i) => {
            const n = `question row ${i}`;
            if (!isRecord(q)) return err(`${n}: must be an object.`);
            const section = typeof q.section === "string" ? q.section.trim() : "";
            const language = typeof q.language === "string" ? q.language.trim() : "";
            const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
            if (!(Object.keys(SCREENING_SECTIONS) as string[]).includes(section)) {
                return err(`${n}: unknown section.`);
            }
            if (section === SCREENING_SECTION.CHAT) {
                return err(`${n}: CHAT is a simulation, not a multiple-choice bank entry.`);
            }
            if (!(WAITLIST_LANGUAGES as readonly string[]).includes(language)) {
                return err(`${n}: unknown language.`);
            }
            if (prompt.length < 3) return err(`${n}: prompt is too short.`);
            const norm = `${language}::${normPrompt(prompt)}`;
            if (seenPrompts.has(norm)) return err(`${n}: duplicate prompt in file.`);
            seenPrompts.add(norm);

            if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5) {
                return err(`${n}: options must have 2 to 5 entries.`);
            }
            const options: string[] = [];
            for (const o of q.options) {
                if (typeof o !== "string" || o.trim().length === 0) {
                    return err(`${n}: every option must be a non-empty string.`);
                }
                options.push(o.trim());
            }
            const lowered = options.map((o) => o.toLowerCase());
            if (new Set(lowered).size !== lowered.length) {
                return err(`${n}: options must all differ.`);
            }
            if (
                typeof q.correctOptionIndex !== "number" ||
                !Number.isInteger(q.correctOptionIndex) ||
                q.correctOptionIndex < 0 ||
                q.correctOptionIndex >= options.length
            ) {
                return err(`${n}: exactly one correct option is required (index in range).`);
            }

            const hasLink =
                q.passageKey !== undefined &&
                q.passageKey !== null &&
                String(q.passageKey).trim() !== "";
            const passageKey = hasLink ? String(q.passageKey).trim() : null;
            if (section === SCREENING_SECTION.READING && !passageKey) {
                return err(`${n}: READING questions must link a passage.`);
            }
            if (section !== SCREENING_SECTION.READING && passageKey) {
                return err(`${n}: only READING questions may link a passage.`);
            }
            questionRows.push({
                index: i,
                section,
                language,
                prompt,
                options,
                correctOptionIndex: q.correctOptionIndex,
                passageKey,
            });
        });

        // Every READING link must resolve to a passage in this file, in the
        // same language.
        const byKey = new Map(passageRows.map((p) => [p.key, p]));
        for (const q of questionRows) {
            if (!q.passageKey) continue;
            const p = byKey.get(q.passageKey);
            if (!p) {
                err(`question row ${q.index}: passage link does not match any passage in file.`);
            } else if (p.language !== q.language) {
                err(`question row ${q.index}: passage language must match the question language.`);
            }
        }
    }
}

if (errors.length > 0) {
    const shown = errors.slice(0, 20).join("\n  - ");
    fail(`validation failed (${errors.length} problem(s)), loading nothing:\n  - ${shown}`);
}

// Duplicates against the database abort the whole load (no writes).
const existing = await db.question.findMany({
    select: { language: true, prompt: true },
});
const existingSet = new Set(existing.map((r) => `${r.language}::${normPrompt(r.prompt)}`));
const clashes = questionRows.filter((q) =>
    existingSet.has(`${q.language}::${normPrompt(q.prompt)}`),
);
if (clashes.length > 0) {
    const firstRow = clashes[0]?.index ?? -1;
    fail(
        `${clashes.length} prompt(s) already exist in the database ` +
            `(first row ${firstRow}), loading nothing. Deactivate the old rows before reloading.`,
    );
}

const counts: Record<string, number> = {};
await db.$transaction(
    async (tx) => {
    const passageIds = new Map<string, string>();
    for (const p of passageRows) {
        const created = await tx.passage.create({
            data: { language: p.language, text: p.text, active: true },
            select: { id: true },
        });
        passageIds.set(p.key, created.id);
    }
    for (const q of questionRows) {
        await tx.question.create({
            data: {
                section: q.section as keyof typeof SCREENING_SECTION,
                language: q.language,
                prompt: q.prompt,
                options: q.options,
                correctOptionIndex: q.correctOptionIndex,
                passageId: q.passageKey ? (passageIds.get(q.passageKey) ?? null) : null,
                active: true,
                pointsTenths: screeningPointsPerQuestionTenths(
                    q.section as keyof typeof SCREENING_SECTION,
                ),
            },
        });
        counts[q.section] = (counts[q.section] ?? 0) + 1;
    }
    },
    // Neon pooler latency: 19 sequential writes exceed the 5s default.
    { timeout: 30000 },
);

await db.$disconnect();

const breakdown = Object.entries(counts)
    .map(([s, c]) => `${s}=${c}`)
    .join(" ");
console.log(
    `loaded ${passageRows.length} passage(s), ${questionRows.length} question(s): ${breakdown}`,
);
