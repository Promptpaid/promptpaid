import { db } from "@/services";
import {
    enabledScreeningSections,
    ONBOARDING_STATUS,
    SCREENING_ATTEMPT_STATUS,
    SCREENING_GRACE_MS,
    SCREENING_MAX_FAILURES_BEFORE_SUSPEND,
    SCREENING_SECTIONS,
    screeningMaxTenths,
    screeningNextAttemptDate,
    screeningPassed,
    screeningScoredHigh,
    SCREENING_TIME_LIMIT_MS,
    USER_STATUS,
    type OnboardingStatus,
    type ScreeningSection,
    type UserStatus,
} from "@promptpaid/shared";
import { transitionOnboardingStatus } from "@/module/onboarding/repo";
import { wrongStatusReply } from "@/module/onboarding/status-gate";
import {
    canAnswerScreening,
    canStartScreening,
    canSubmitScreening,
    canViewScreeningResult,
    type AccountPosition,
} from "./status-gate";
import {
    closeAttemptWithScores,
    createAttemptWithQuestions,
    findActiveBank,
    findLatestClosedAttempt,
    findOpenAttemptForAnswer,
    findOpenAttemptForGrading,
    findOpenAttemptPublic,
    isAttemptConflict,
    listAttemptsForUser,
    saveAnswersTx,
    type AttemptHistoryRow,
    type BankRow,
    type GradingAttempt,
    type OpenAttemptPublic,
    type ScreeningTx,
    type SectionScoresTenths,
} from "./repo";
import { deleteUserSessions, setAccountStatus } from "@/module/auth/repo";

const START_TX_TIMEOUT_MS = 15000;

export interface StartScreeningInput {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    languages: string[];
}

export interface PublicQuestion {
    id: string;
    position: number;
    section: ScreeningSection;
    prompt: string;
    options: string[];
    answer: { chosenDisplayedIndex: number; answeredAt: Date } | null;
}

export interface PublicAttempt {
    id: string;
    attemptNumber: number;
    secondsRemaining: number;
    questions: PublicQuestion[];
}

/** Fisher-Yates: returns a shuffled copy, inputs untouched. */
function shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        copy[i] = b as T;
        copy[j] = a as T;
    }
    return copy;
}

function secondsRemaining(deadline: Date, now: Date): number {
    return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000));
}

function isPastGrace(deadline: Date, now: Date): boolean {
    return now.getTime() > deadline.getTime() + SCREENING_GRACE_MS;
}

function toPublicQuestion(row: OpenAttemptPublic["questions"][number]): PublicQuestion {
    const displayed = row.optionOrder.map((original) => row.snapshotOptions[original] as string);
    return {
        id: row.id,
        position: row.position,
        section: row.snapshotSection as ScreeningSection,
        prompt: row.question.prompt,
        options: displayed,
        answer: row.answer
            ? { chosenDisplayedIndex: row.answer.chosenDisplayedIndex, answeredAt: row.answer.answeredAt }
            : null,
    };
}

function toPublicAttempt(
    attempt: Pick<OpenAttemptPublic, "id" | "attemptNumber" | "deadline">,
    questions: PublicQuestion[],
    now: Date,
): PublicAttempt {
    return {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        secondsRemaining: secondsRemaining(attempt.deadline, now),
        questions,
    };
}

interface FailureInfo {
    count: number;
    lastFailedAt: Date | null;
}

/** Closed attempts that did not pass count as failures (null = not yet graded). */
function failuresOf(history: readonly AttemptHistoryRow[]): FailureInfo {
    const failed = history.filter(
        (row) =>
            row.status !== SCREENING_ATTEMPT_STATUS.OPEN && row.passed !== true,
    );
    let lastFailedAt: Date | null = null;
    for (const row of failed) {
        const at = row.submittedAt ?? null;
        if (at && (!lastFailedAt || at.getTime() > lastFailedAt.getTime())) {
            lastFailedAt = at;
        }
    }
    return { count: failed.length, lastFailedAt };
}

export interface PublicResult {
    attemptNumber: number;
    closedAs: "SUBMITTED" | "EXPIRED";
    passed: boolean;
    sectionScoresTenths: SectionScoresTenths;
    totalTenths: number;
    maxTenths: number;
    scored90Plus: boolean;
    submittedAt: Date;
    nextAttemptDate: string | null;
    suspended: boolean;
}

/**
 * THE grading function: the single code path for submit and expiry. Reads
 * only the start snapshot (correct index, points, displayed-order mapping);
 * unanswered questions score zero. All maths in integer tenths.
 */
export function gradeFromSnapshot(
    questions: ReadonlyArray<GradingAttempt["questions"][number]>,
): { scores: SectionScoresTenths; totalTenths: number } {
    const scores: SectionScoresTenths = { LANGUAGE: 0, READING: 0, CHAT: 0, JUDGMENT: 0 };
    for (const q of questions) {
        const chosen = q.answer?.chosenDisplayedIndex;
        if (chosen === undefined || chosen === null) continue;
        const original = q.optionOrder[chosen];
        if (original === undefined || original !== q.snapshotCorrectIndex) continue;
        const section = q.snapshotSection as ScreeningSection;
        scores[section] += q.snapshotPointsTenths;
    }
    const totalTenths = scores.LANGUAGE + scores.READING + scores.CHAT + scores.JUDGMENT;
    return { scores, totalTenths };
}

/**
 * THE close path: grade in memory, then ONE short transaction that stores the
 * scores, closes the attempt, and moves the journey status. The close is
 * conditional on OPEN, so a closed attempt is never edited or regraded;
 * count 0 means a concurrent call closed it first.
 */
async function gradeAndCloseAttempt(input: {
    userId: string;
    attempt: GradingAttempt;
    failuresBefore: number;
    closeAs: "SUBMITTED" | "EXPIRED";
    now: Date;
}): Promise<{ closed: boolean; result: PublicResult | null }> {
    const { scores, totalTenths } = gradeFromSnapshot(input.attempt.questions);
    const maxTenths = input.attempt.maxTenths;
    const passed = screeningPassed(totalTenths, maxTenths);
    const scored90Plus = screeningScoredHigh(totalTenths, maxTenths);
    const failuresAfter = input.failuresBefore + (passed ? 0 : 1);
    const suspend = !passed && failuresAfter >= SCREENING_MAX_FAILURES_BEFORE_SUSPEND;

    const stored = await db.$transaction(
        async (tx) => {
            const closed = await closeAttemptWithScores(tx, {
                attemptId: input.attempt.id,
                closeAs:
                    input.closeAs === "SUBMITTED"
                        ? SCREENING_ATTEMPT_STATUS.SUBMITTED
                        : SCREENING_ATTEMPT_STATUS.EXPIRED,
                scores,
                totalTenths,
                maxTenths,
                passed,
                scored90Plus,
                now: input.now,
            });
            if (closed.count === 0) return null;
            if (passed) {
                await transitionOnboardingStatus(
                    input.userId,
                    [ONBOARDING_STATUS.SCREENING_IN_PROGRESS],
                    ONBOARDING_STATUS.SCREENING_PASSED,
                    tx,
                );
            } else if (suspend) {
                await setAccountStatus(input.userId, USER_STATUS.SUSPENDED, tx);
                await deleteUserSessions(input.userId, tx);
            } else {
                await transitionOnboardingStatus(
                    input.userId,
                    [ONBOARDING_STATUS.SCREENING_IN_PROGRESS],
                    ONBOARDING_STATUS.PROFILE_COMPLETE,
                    tx,
                );
            }
            return { suspended: suspend };
        },
        { timeout: START_TX_TIMEOUT_MS },
    );

    if (!stored) return { closed: false, result: null };

    return {
        closed: true,
        result: {
            attemptNumber: input.attempt.attemptNumber,
            closedAs: input.closeAs,
            passed,
            sectionScoresTenths: scores,
            totalTenths,
            maxTenths,
            scored90Plus,
            submittedAt: input.now,
            nextAttemptDate:
                !passed && !suspend
                    ? screeningNextAttemptDate(input.now, failuresAfter).toISOString()
                    : null,
            suspended: stored.suspended,
        },
    };
}

/**
 * Expiry safety net (no background job): if the open attempt is past its
 * deadline plus grace, grade what was saved and close it as expired through
 * the same single grading path as submit, then the caller continues.
 */
export async function expireOpenAttemptIfPastGrace(input: {
    userId: string;
    deadline: Date;
    now: Date;
}): Promise<{ expired: boolean }> {
    if (!isPastGrace(input.deadline, input.now)) return { expired: false };

    const history = await listAttemptsForUser(input.userId);
    const attempt = await findOpenAttemptForGrading(input.userId);
    if (!attempt) return { expired: false };
    await gradeAndCloseAttempt({
        userId: input.userId,
        attempt,
        failuresBefore: failuresOf(history).count,
        closeAs: "EXPIRED",
        now: input.now,
    });

    return { expired: true };
}

export async function startScreening(input: StartScreeningInput) {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canStartScreening(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const now = new Date();

    // Idempotent first: an open attempt is returned, never duplicated.
    const existing = await findOpenAttemptPublic(input.userId);
    if (existing) {
        const expired = await expireOpenAttemptIfPastGrace({
            userId: input.userId,
            deadline: existing.deadline,
            now,
        });
        if (!expired.expired) {
            return {
                status: "ok" as const,
                created: false as const,
                attempt: toPublicAttempt(
                    existing,
                    existing.questions.map((q) => toPublicQuestion(q)),
                    now,
                ),
            };
        }
        // Expired and closed above; fall through to the create path, where the
        // just-closed attempt counts as a consumed failure.
    }

    const history = await listAttemptsForUser(input.userId);
    const failures = failuresOf(history);

    if (failures.count >= SCREENING_MAX_FAILURES_BEFORE_SUSPEND) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    if (failures.count > 0) {
        const nextDate = failures.lastFailedAt
            ? screeningNextAttemptDate(failures.lastFailedAt, failures.count)
            : new Date(now.getTime());
        if (now.getTime() < nextDate.getTime()) {
            return {
                status: "cooldown" as const,
                httpStatus: 403 as const,
                body: {
                    status: "cooldown" as const,
                    message: `You can try again on ${nextDate.toISOString().slice(0, 10)}.`,
                    nextAttemptDate: nextDate.toISOString(),
                    failures: failures.count,
                },
            };
        }
    }

    // Slow reading BEFORE any transaction: whole active bank for the language,
    // then shuffle and draw in memory.
    const language = input.languages[0] ?? "english";
    const sections = enabledScreeningSections();
    const bank = await findActiveBank(language, sections);
    const draw = drawQuestions(bank, sections);
    if (!draw) {
        return {
            status: "no_bank" as const,
            httpStatus: 503 as const,
            body: {
                status: "unavailable" as const,
                message: "The screening test is not ready yet. Please try again later.",
            },
        };
    }

    const attemptNumber =
        history.reduce((max, row) => Math.max(max, row.attemptNumber), 0) + 1;
    const deadline = new Date(now.getTime() + SCREENING_TIME_LIMIT_MS);
    const maxTenths = screeningMaxTenths();

    // Short transaction: conditional status move, then attempt + questions in
    // ONE nested statement. A concurrent start loses the race on the partial
    // one-open-attempt index (P2002) and falls back to returning the winner.
    try {
        const created = await db.$transaction(
            async (tx) => {
                const moved = await transitionOnboardingStatusTx(tx, input.userId);
                if (moved.count === 0) return null;
                const attempt = await createAttemptWithQuestions({
                    tx,
                    userId: input.userId,
                    attemptNumber,
                    deadline,
                    maxTenths,
                    items: draw.items,
                });
                const questions = await tx.attemptQuestion.findMany({
                    where: { attemptId: attempt.id },
                    orderBy: { position: "asc" },
                    select: {
                        id: true,
                        position: true,
                        optionOrder: true,
                        snapshotOptions: true,
                        snapshotSection: true,
                        question: { select: { prompt: true } },
                        answer: {
                            select: { chosenDisplayedIndex: true, answeredAt: true },
                        },
                    },
                });
                return { attempt, questions };
            },
            { timeout: START_TX_TIMEOUT_MS },
        );

        if (!created) {
            return { status: "wrong_status" as const, ...wrongStatusReply(position) };
        }

        return {
            status: "ok" as const,
            created: true as const,
            attempt: toPublicAttempt(
                created.attempt,
                created.questions.map((q) => toPublicQuestion(q)),
                now,
            ),
        };
    } catch (err) {
        if (isAttemptConflict(err)) {
            const winner = await findOpenAttemptPublic(input.userId);
            if (winner) {
                return {
                    status: "ok" as const,
                    created: false as const,
                    attempt: toPublicAttempt(
                        winner,
                        winner.questions.map((q) => toPublicQuestion(q)),
                        new Date(),
                    ),
                };
            }
        }
        throw err;
    }
}

/** Status move inside the start transaction: the same single helper. */
async function transitionOnboardingStatusTx(tx: ScreeningTx, userId: string) {
    return transitionOnboardingStatus(
        userId,
        [ONBOARDING_STATUS.PROFILE_COMPLETE],
        ONBOARDING_STATUS.SCREENING_IN_PROGRESS,
        tx,
    );
}

/** Draw `questionCount` random questions per enabled section with snapshots. */
function drawQuestions(bank: BankRow[], sections: readonly ScreeningSection[]) {
    const items: {
        questionId: string;
        position: number;
        optionOrder: number[];
        snapshotOptions: string[];
        snapshotCorrectIndex: number;
        snapshotPointsTenths: number;
        snapshotSection: ScreeningSection;
    }[] = [];
    let position = 0;
    for (const section of sections) {
        const count = SCREENING_SECTIONS[section].questionCount;
        const pool = shuffled(bank.filter((row) => (row.section as string) === section));
        if (pool.length < count || count === 0) {
            if (count === 0) continue;
            return null;
        }
        for (const row of pool.slice(0, count)) {
            const order = shuffled(row.options.map((_, i) => i));
            items.push({
                questionId: row.id,
                position: position++,
                optionOrder: order,
                snapshotOptions: [...row.options],
                snapshotCorrectIndex: row.correctOptionIndex,
                snapshotPointsTenths: row.pointsTenths,
                snapshotSection: section,
            });
        }
    }
    return { items };
}

export async function readCurrentScreening(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}) {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canStartScreening(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const now = new Date();
    const open = await findOpenAttemptPublic(input.userId);
    if (!open) {
        return {
            status: "none" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "No open screening attempt.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    const expired = await expireOpenAttemptIfPastGrace({
        userId: input.userId,
        deadline: open.deadline,
        now,
    });
    if (expired.expired) {
        return {
            status: "none" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "The screening attempt expired.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    return {
        status: "ok" as const,
        attempt: toPublicAttempt(
            open,
            open.questions.map((q) => toPublicQuestion(q)),
            now,
        ),
    };
}
import type { ScreeningAnswerInput } from "@promptpaid/shared";

export async function saveScreeningAnswers(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    answers: ScreeningAnswerInput["answers"];
}) {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canAnswerScreening(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const now = new Date();
    const open = await findOpenAttemptForAnswer(input.userId);
    if (!open) {
        return {
            status: "none" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "No open screening attempt.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    if (isPastGrace(open.deadline, now)) {
        return {
            status: "expired" as const,
            httpStatus: 409 as const,
            body: {
                status: "expired" as const,
                message: "Time is up for this attempt.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    // Last value wins within one batch; every id must belong to this attempt
    // and every index must fit the options shown for that question.
    const byQuestion = new Map<string, number>();
    for (const a of input.answers) byQuestion.set(a.attemptQuestionId, a.chosenDisplayedIndex);

    const optionCounts = new Map(open.questions.map((q) => [q.id, q.optionOrder.length]));
    for (const [questionId, chosen] of byQuestion) {
        const count = optionCounts.get(questionId);
        if (count === undefined) {
            return {
                status: "invalid" as const,
                httpStatus: 400 as const,
                body: {
                    status: "invalid" as const,
                    errors: { answers: ["One of the questions is not part of this attempt."] },
                },
            };
        }
        if (chosen >= count) {
            return {
                status: "invalid" as const,
                httpStatus: 400 as const,
                body: {
                    status: "invalid" as const,
                    errors: { answers: ["One of the options does not belong to its question."] },
                },
            };
        }
    }

    await db.$transaction(
        async (tx) => {
            await saveAnswersTx(
                tx,
                [...byQuestion].map(([attemptQuestionId, chosenDisplayedIndex]) => ({
                    attemptQuestionId,
                    chosenDisplayedIndex,
                    now,
                })),
            );
        },
        { timeout: START_TX_TIMEOUT_MS },
    );

    return {
        status: "ok" as const,
        saved: byQuestion.size,
        secondsRemaining: secondsRemaining(open.deadline, new Date()),
    };
}

function storedResultBody(
    row: NonNullable<Awaited<ReturnType<typeof findLatestClosedAttempt>>>,
    nextAttemptDate: string | null,
    suspended: boolean,
) {
    return {
        attemptNumber: row.attemptNumber,
        closedAs: row.status as "SUBMITTED" | "EXPIRED",
        passed: row.passed ?? false,
        sectionScoresTenths: {
            LANGUAGE: row.languageScoreTenths,
            READING: row.readingScoreTenths,
            CHAT: row.chatScoreTenths,
            JUDGMENT: row.judgmentScoreTenths,
        },
        totalTenths: row.totalScoreTenths,
        maxTenths: row.maxTenths,
        scored90Plus: row.scored90Plus,
        submittedAt: row.submittedAt,
        nextAttemptDate,
        suspended,
    };
}

export async function submitScreening(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}) {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canSubmitScreening(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const now = new Date();
    const history = await listAttemptsForUser(input.userId);
    const failuresBefore = failuresOf(history).count;

    const attempt = await findOpenAttemptForGrading(input.userId);
    if (!attempt) {
        // Repeat submit (or submit with nothing open): return the stored
        // result instead of grading anything again.
        const latest = await findLatestClosedAttempt(input.userId);
        if (!latest) {
            return {
                status: "none" as const,
                httpStatus: 404 as const,
                body: {
                    status: "not_found" as const,
                    message: "No open screening attempt.",
                    nextStep: wrongStatusReply(position).body.nextStep,
                },
            };
        }
        const failures = failuresOf(history);
        return {
            status: "ok" as const,
            repeated: true as const,
            result: {
                ...storedResultBody(latest, null, false),
                nextAttemptDate:
                    latest.passed === true
                        ? null
                        : failures.lastFailedAt
                          ? screeningNextAttemptDate(
                                failures.lastFailedAt,
                                failures.count,
                            ).toISOString()
                          : null,
            },
        };
    }

    const closeAs = isPastGrace(attempt.deadline, now) ? "EXPIRED" : "SUBMITTED";
    const closed = await gradeAndCloseAttempt({
        userId: input.userId,
        attempt,
        failuresBefore,
        closeAs,
        now,
    });

    if (!closed.closed || !closed.result) {
        // A concurrent submit won the race; return what it stored.
        const latest = await findLatestClosedAttempt(input.userId);
        if (!latest) {
            return { status: "wrong_status" as const, ...wrongStatusReply(position) };
        }
        const failures = failuresOf(await listAttemptsForUser(input.userId));
        return {
            status: "ok" as const,
            repeated: true as const,
            result: {
                ...storedResultBody(latest, null, false),
                nextAttemptDate:
                    latest.passed === true
                        ? null
                        : failures.lastFailedAt
                          ? screeningNextAttemptDate(
                                failures.lastFailedAt,
                                failures.count,
                            ).toISOString()
                          : null,
            },
        };
    }

    return { status: "ok" as const, repeated: false as const, result: closed.result };
}

export async function readScreeningResult(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}) {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canViewScreeningResult(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const [history, latest] = await Promise.all([
        listAttemptsForUser(input.userId),
        findLatestClosedAttempt(input.userId),
    ]);
    if (!latest) {
        return {
            status: "none" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "No screening result yet.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    const failures = failuresOf(history);
    return {
        status: "ok" as const,
        result: {
            ...storedResultBody(latest, null, false),
            nextAttemptDate:
                latest.passed === true
                    ? null
                    : failures.lastFailedAt
                      ? screeningNextAttemptDate(failures.lastFailedAt, failures.count).toISOString()
                      : null,
        },
    };
}
