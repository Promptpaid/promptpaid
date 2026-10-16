import { db } from "@/services";
import type { Database } from "@promptpaid/db";
import {
    SCREENING_ATTEMPT_STATUS,
    type ScreeningSection,
} from "@promptpaid/shared";

/** Transaction client: only the delegates screening touches. */
export type ScreeningTx = Pick<Database, "attempt" | "attemptQuestion" | "answer" | "session" | "user">;

/** Attempt history rows: counts and cooldowns only, never content. */
export async function listAttemptsForUser(userId: string) {
    return db.attempt.findMany({
        where: { userId },
        orderBy: { attemptNumber: "asc" },
        select: {
            attemptNumber: true,
            status: true,
            deadline: true,
            submittedAt: true,
            passed: true,
        },
    });
}

export type AttemptHistoryRow = Awaited<ReturnType<typeof listAttemptsForUser>>[number];

/**
 * The open attempt as the web may see it. Selects prompts and the DISPLAYED
 * option order only. Never selects the bank's question id, the correct
 * option, or any score: those must not leave the server.
 */
const publicQuestionSelect = {
    id: true,
    position: true,
    optionOrder: true,
    snapshotOptions: true,
    snapshotSection: true,
    // Display only: the taker already sees this text. Grading never reads it;
    // grading inputs (correct index, points, option mapping) are snapshotted.
    question: { select: { prompt: true } },
    answer: {
        select: { chosenDisplayedIndex: true, answeredAt: true },
    },
} as const;

export async function findOpenAttemptPublic(userId: string) {
    return db.attempt.findFirst({
        where: { userId, status: SCREENING_ATTEMPT_STATUS.OPEN },
        select: {
            id: true,
            attemptNumber: true,
            startedAt: true,
            deadline: true,
            maxTenths: true,
            questions: {
                orderBy: { position: "asc" },
                select: publicQuestionSelect,
            },
        },
    });
}

export type OpenAttemptPublic = NonNullable<Awaited<ReturnType<typeof findOpenAttemptPublic>>>;

/** Same safe projection, by attempt id (used right after creating it). */
export async function findAttemptQuestionsPublic(attemptId: string) {
    return db.attemptQuestion.findMany({
        where: { attemptId },
        orderBy: { position: "asc" },
        select: publicQuestionSelect,
    });
}

/**
 * Open attempt for saving answers: membership (question ids in this attempt)
 * plus the valid option range per question. Server-side only.
 */
export async function findOpenAttemptForAnswer(userId: string) {
    return db.attempt.findFirst({
        where: { userId, status: SCREENING_ATTEMPT_STATUS.OPEN },
        select: {
            id: true,
            deadline: true,
            questions: {
                orderBy: { position: "asc" },
                select: { id: true, optionOrder: true },
            },
        },
    });
}

/**
 * Open attempt for grading: snapshot inputs plus saved answers. The correct
 * option and points travel here so grading never touches the live bank.
 * Server-side only, never serialized to a response.
 */
export async function findOpenAttemptForGrading(userId: string) {
    return db.attempt.findFirst({
        where: { userId, status: SCREENING_ATTEMPT_STATUS.OPEN },
        select: {
            id: true,
            attemptNumber: true,
            deadline: true,
            maxTenths: true,
            questions: {
                orderBy: { position: "asc" },
                select: {
                    snapshotCorrectIndex: true,
                    snapshotPointsTenths: true,
                    snapshotSection: true,
                    optionOrder: true,
                    answer: { select: { chosenDisplayedIndex: true } },
                },
            },
        },
    });
}

export type GradingAttempt = NonNullable<Awaited<ReturnType<typeof findOpenAttemptForGrading>>>;

/** Latest closed attempt with its stored (permanent) result. */
export async function findLatestClosedAttempt(userId: string) {
    return db.attempt.findFirst({
        where: { userId, status: { not: SCREENING_ATTEMPT_STATUS.OPEN } },
        orderBy: { attemptNumber: "desc" },
        select: {
            attemptNumber: true,
            status: true,
            submittedAt: true,
            languageScoreTenths: true,
            readingScoreTenths: true,
            chatScoreTenths: true,
            judgmentScoreTenths: true,
            totalScoreTenths: true,
            maxTenths: true,
            passed: true,
            scored90Plus: true,
        },
    });
}

/**
 * Idempotent answer saves in TWO statements regardless of batch size (Neon
 * pooler latency kills long interactive transactions): delete this batch's
 * rows, then recreate them. Same batch twice ends in the same state.
 */
export async function saveAnswersTx(
    tx: ScreeningTx,
    items: { attemptQuestionId: string; chosenDisplayedIndex: number; now: Date }[],
) {
    const ids = items.map((item) => item.attemptQuestionId);
    await tx.answer.deleteMany({ where: { attemptQuestionId: { in: ids } } });
    await tx.answer.createMany({
        data: items.map((item) => ({
            attemptQuestionId: item.attemptQuestionId,
            chosenDisplayedIndex: item.chosenDisplayedIndex,
            answeredAt: item.now,
        })),
    });
    return { count: items.length };
}

export interface SectionScoresTenths {
    LANGUAGE: number;
    READING: number;
    CHAT: number;
    JUDGMENT: number;
}

/**
 * THE only writer of attempt scores. Conditional on OPEN, so a closed attempt
 * can never be edited or regraded. Count 0 means someone closed it first.
 */
export async function closeAttemptWithScores(
    tx: ScreeningTx,
    input: {
        attemptId: string;
        closeAs: typeof SCREENING_ATTEMPT_STATUS.SUBMITTED | typeof SCREENING_ATTEMPT_STATUS.EXPIRED;
        scores: SectionScoresTenths;
        totalTenths: number;
        maxTenths: number;
        passed: boolean;
        scored90Plus: boolean;
        now: Date;
    },
) {
    const result = await tx.attempt.updateMany({
        where: { id: input.attemptId, status: SCREENING_ATTEMPT_STATUS.OPEN },
        data: {
            status: input.closeAs,
            submittedAt: input.now,
            languageScoreTenths: input.scores.LANGUAGE,
            readingScoreTenths: input.scores.READING,
            chatScoreTenths: input.scores.CHAT,
            judgmentScoreTenths: input.scores.JUDGMENT,
            totalScoreTenths: input.totalTenths,
            maxTenths: input.maxTenths,
            passed: input.passed,
            scored90Plus: input.scored90Plus,
        },
    });
    return { count: result.count };
}

/**
 * Bank rows for drawing an attempt. Read BEFORE opening a transaction and
 * kept server-side only: `correctOptionIndex` is snapshotted into the attempt
 * and never serialized to any response.
 */
export async function findActiveBank(language: string, sections: readonly ScreeningSection[]) {
    return db.question.findMany({
        where: {
            active: true,
            language,
            section: { in: [...sections] },
        },
        select: {
            id: true,
            section: true,
            prompt: true,
            options: true,
            correctOptionIndex: true,
            pointsTenths: true,
        },
    });
}

export type BankRow = Awaited<ReturnType<typeof findActiveBank>>[number];

export interface AttemptQuestionSnapshot {
    questionId: string;
    position: number;
    optionOrder: number[];
    snapshotOptions: string[];
    snapshotCorrectIndex: number;
    snapshotPointsTenths: number;
    snapshotSection: ScreeningSection;
}

/**
 * Creates the attempt and ALL of its questions in ONE statement (nested
 * createMany): a single round trip, so start stays fast on Neon.
 */
export async function createAttemptWithQuestions(input: {
    tx: ScreeningTx;
    userId: string;
    attemptNumber: number;
    deadline: Date;
    maxTenths: number;
    items: AttemptQuestionSnapshot[];
}) {
    return input.tx.attempt.create({
        data: {
            userId: input.userId,
            attemptNumber: input.attemptNumber,
            deadline: input.deadline,
            maxTenths: input.maxTenths,
            questions: { createMany: { data: input.items } },
        },
        select: { id: true, attemptNumber: true, startedAt: true, deadline: true, maxTenths: true },
    });
}

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
    );
}

/** The partial one-open-attempt index AND the (userId, attemptNumber) key both surface here. */
export function isAttemptConflict(err: unknown): boolean {
    return isUniqueViolation(err);
}
