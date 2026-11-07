/**
 * Dev-only loader for the task scenarios.
 *
 * Safety rails (mirrors scripts/load-questions.ts):
 *   - refuses to run unless NODE_ENV is exactly "development"
 *   - refuses unless the database host is in DEV_SEED_ALLOWED_HOSTS
 *     (comma-separated) AND the database name is in DEV_SEED_ALLOWED_DATABASES
 *     (comma-separated); empty/unset lists fail closed
 *   - prints only the database host and name (never the URL or password)
 *
 * Validation (all-or-nothing: any failure loads zero rows, and error messages
 * reference row numbers only, never scenario content):
 *   - required fields present and known difficulty/category
 *   - minimumTurns >= TASK_MIN_EXCHANGES (from shared)
 *   - no duplicate titles per language (inside file, and against database)
 *
 * Usage:
 *   DEV_SEED_ALLOWED_HOSTS=<host> DEV_SEED_ALLOWED_DATABASES=<db> \
 *     pnpm -F server dev:load-scenarios <path/to/scenarios.json>
 *
 * Example:
 *   DEV_SEED_ALLOWED_HOSTS=ep-xxx-pooler.aws.neon.tech DEV_SEED_ALLOWED_DATABASES=neondb \
 *     pnpm -F server dev:load-scenarios scripts/scenarios-test-data.json
 */
import fs from "node:fs";
import { TASK_MIN_EXCHANGES } from "@promptpaid/shared";
import { ENV } from "../src/env.server";
import { db } from "../src/services";

const DIFFICULTY = ["EASY", "MEDIUM", "HARD", "EXPERT"] as const;
type Difficulty = (typeof DIFFICULTY)[number];

const SCENARIO_CATEGORY = ["TEXT_CONVERSATION", "MULTI_LANGUAGE", "CULTURAL_CONTEXT"] as const;
type ScenarioCategory = (typeof SCENARIO_CATEGORY)[number];

function fail(message: string): never {
    console.error(`load-scenarios: ${message}`);
    process.exit(1);
}

const [fileArg] = process.argv.slice(2);

if (ENV.NODE_ENV !== "development") {
    fail(`refusing to run outside development (NODE_ENV=${ENV.NODE_ENV}).`);
}

const url = new URL(ENV.DATABASE_URL);
const host = url.hostname;
const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] ?? "");

console.log(`load-scenarios: host=${host} database=${database}`);

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
    fail("usage: dev:load-scenarios <path/to/scenarios.json>");
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

interface ScenarioRow {
    index: number;
    title: string;
    language: string;
    aiRole: string;
    userRole: string;
    objective: string;
    minimumTurns: number;
    difficulty: Difficulty;
    category: ScenarioCategory;
}

const scenarioRows: ScenarioRow[] = [];

if (!isRecord(raw)) {
    err("file root must be an object with scenarios[] array.");
} else {
    const scenarios = raw.scenarios;
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
        err("scenarios must be a non-empty array.");
    } else {
        const seenTitlesPerLang = new Map<string, Set<string>>();

        scenarios.forEach((s, i) => {
            const n = `scenario row ${i}`;
            if (!isRecord(s)) return err(`${n}: must be an object.`);

            const title = typeof s.title === "string" ? s.title.trim() : "";
            const language = typeof s.language === "string" ? s.language.trim().toLowerCase() : "";
            const aiRole = typeof s.aiRole === "string" ? s.aiRole.trim() : "";
            const userRole = typeof s.userRole === "string" ? s.userRole.trim() : "";
            const objective = typeof s.objective === "string" ? s.objective.trim() : "";
            const minimumTurns = typeof s.minimumTurns === "number" ? s.minimumTurns : NaN;
            const difficulty = typeof s.difficulty === "string" ? s.difficulty.trim().toUpperCase() : "";
            const category = typeof s.category === "string" ? s.category.trim().toUpperCase() : "";

            if (!title) return err(`${n}: title is required.`);
            if (!language) return err(`${n}: language is required.`);
            if (!aiRole) return err(`${n}: aiRole is required.`);
            if (!userRole) return err(`${n}: userRole is required.`);
            if (!objective) return err(`${n}: objective is required.`);
            if (!Number.isInteger(minimumTurns) || minimumTurns < TASK_MIN_EXCHANGES) {
                return err(`${n}: minimumTurns must be an integer >= ${TASK_MIN_EXCHANGES}.`);
            }
            if (!DIFFICULTY.includes(difficulty as Difficulty)) {
                return err(`${n}: unknown difficulty. Must be one of: ${DIFFICULTY.join(", ")}.`);
            }
            if (!SCENARIO_CATEGORY.includes(category as ScenarioCategory)) {
                return err(`${n}: unknown category. Must be one of: ${SCENARIO_CATEGORY.join(", ")}.`);
            }

            // Duplicate title per language (in file)
            const langKey = language.toLowerCase();
            if (!seenTitlesPerLang.has(langKey)) seenTitlesPerLang.set(langKey, new Set());
            const langSet = seenTitlesPerLang.get(langKey)!;
            const normTitle = title.toLowerCase();
            if (langSet.has(normTitle)) {
                return err(`${n}: duplicate title for language "${language}" in file.`);
            }
            langSet.add(normTitle);

            scenarioRows.push({
                index: i,
                title,
                language,
                aiRole,
                userRole,
                objective,
                minimumTurns,
                difficulty: difficulty as Difficulty,
                category: category as ScenarioCategory,
            });
        });
    }
}

// Duplicates against the database abort the whole load (no writes).
if (errors.length === 0) {
    const existing = await db.scenario.findMany({
        select: { title: true, language: true },
    });
    const existingByLang = new Map<string, Set<string>>();
    for (const e of existing) {
        const lang = e.language.toLowerCase();
        if (!existingByLang.has(lang)) existingByLang.set(lang, new Set());
        existingByLang.get(lang)!.add(e.title.toLowerCase());
    }
    for (const s of scenarioRows) {
        const lang = s.language.toLowerCase();
        const existingSet = existingByLang.get(lang);
        if (existingSet?.has(s.title.toLowerCase())) {
            err(`scenario row ${s.index}: title "${s.title}" already exists for language "${s.language}" in database.`);
        }
    }
}

if (errors.length > 0) {
    const shown = errors.slice(0, 20).join("\n  - ");
    fail(`validation failed (${errors.length} problem(s)), loading nothing:\n  - ${shown}`);
}

await db.$transaction(
    async (tx) => {
        for (const s of scenarioRows) {
            await tx.scenario.create({
                data: {
                    title: s.title,
                    language: s.language,
                    aiRole: s.aiRole,
                    userRole: s.userRole,
                    objective: s.objective,
                    minimumTurns: s.minimumTurns,
                    difficulty: s.difficulty,
                    category: s.category,
                    active: true,
                },
            });
        }
    },
    { timeout: 30000 },
);

await db.$disconnect();

console.log(`loaded ${scenarioRows.length} scenario(s).`);