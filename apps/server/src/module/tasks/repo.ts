import { db } from "@/services";
import type { Database } from "@promptpaid/db";
import {
    CONVERSATION_STATUS,
    type Difficulty,
    TASK_MAX_MESSAGE_LENGTH,
    TASK_MIN_WORDS_PER_MESSAGE,
    TASK_UNIQUENESS_THRESHOLD,
} from "@promptpaid/shared";

// Prisma Json field type - use any to avoid type issues with Prisma's Json field
type JsonFieldValue = any;

/**
 * Set tutorialCompletedAt if not already set.
 * Idempotent: if already set, does nothing and returns the existing timestamp.
 */
export async function setTutorialCompleted(
    userId: string,
    client: Pick<Database, "user"> = db,
) {
    const user = await client.user.findUnique({
        where: { id: userId },
        select: { tutorialCompletedAt: true },
    });

    if (user?.tutorialCompletedAt) {
        return { alreadyCompleted: true as const, completedAt: user.tutorialCompletedAt };
    }

    const updated = await client.user.update({
        where: { id: userId },
        data: { tutorialCompletedAt: new Date() },
        select: { tutorialCompletedAt: true },
    });

    // tutorialCompletedAt is set to new Date() above, so it cannot be null here
    return { alreadyCompleted: false as const, completedAt: updated.tutorialCompletedAt! };
}

/**
 * Find the user's active conversation (IN_PROGRESS).
 */
export async function findActiveConversation(userId: string) {
    return db.conversation.findFirst({
        where: {
            userId,
            status: CONVERSATION_STATUS.IN_PROGRESS,
        },
        orderBy: { startedAt: "desc" },
    });
}

/**
 * Count conversations started today in user's timezone.
 * The dayKey is stored as YYYY-MM-DD in user's timezone at conversation start.
 */
export async function countConversationsStartedToday(userId: string, dayKey: string) {
    return db.conversation.count({
        where: {
            userId,
            dayKey,
        },
    });
}

/**
 * Check if user has an expired daily allowance (for the current day in their timezone).
 * Returns the dayKey used for counting.
 */
export function getDayKeyForTimezone(timezone: string): string {
    const now = new Date();
    // Format as YYYY-MM-DD in the user's timezone
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(now); // Returns YYYY-MM-DD
}

/**
 * Get count of conversations started today and remaining allowance.
 */
export async function getDailyAllowanceInfo(
    userId: string,
    timezone: string,
    tierDailyLimit: number,
    startCapPerDay: number,
) {
    const dayKey = getDayKeyForTimezone(timezone);
    const startedToday = await countConversationsStartedToday(userId, dayKey);
    const remaining = Math.max(0, tierDailyLimit - startedToday);
    const canStart = startedToday < tierDailyLimit && startedToday < startCapPerDay;
    return { dayKey, startedToday, remaining, canStart };
}

/**
 * Find a random active scenario for the user's language and allowed difficulties,
 * preferring scenarios the user hasn't done before.
 */
export async function findRandomScenario(
    userId: string,
    language: string,
    allowedDifficulties: Difficulty[],
) {
    // First, get scenario IDs the user has already completed (SUBMITTED, PENDING_REVIEW, AUTO_REJECTED, EXPIRED, APPROVED, REJECTED)
    const doneScenarioIds = await db.conversation.findMany({
        where: {
            userId,
            scenarioLanguage: language,
            status: {
                not: CONVERSATION_STATUS.IN_PROGRESS,
            },
        },
        select: { scenarioId: true },
        distinct: ["scenarioId"],
    });
    const doneIds = new Set(doneScenarioIds.map((c) => c.scenarioId));

    // Get all active scenarios for the language and allowed difficulties
    const allScenarios = await db.scenario.findMany({
        where: {
            language,
            active: true,
            difficulty: { in: allowedDifficulties },
        },
        select: { id: true },
    });

    // Separate into unseen and seen
    const unseen = allScenarios.filter((s) => !doneIds.has(s.id));
    const seen = allScenarios.filter((s) => doneIds.has(s.id));

    // Prefer unseen
    const pool = unseen.length > 0 ? unseen : seen;
    if (pool.length === 0) return null;

    // Pick random
    const randomIndex = Math.floor(Math.random() * pool.length);
    const picked = pool[randomIndex];
    return picked ? picked.id : null;
}

/**
 * Get full scenario details for snapshotting.
 */
export async function getScenarioForSnapshot(scenarioId: string) {
    return db.scenario.findUnique({
        where: { id: scenarioId },
        select: {
            id: true,
            title: true,
            language: true,
            aiRole: true,
            userRole: true,
            objective: true,
            minimumTurns: true,
            difficulty: true,
            category: true,
        },
    });
}

/**
 * Create a new conversation with scenario snapshot.
 */
export async function createConversation(
    input: {
        userId: string;
        scenarioId: string;
        scenarioSnapshot: {
            title: string;
            language: string;
            aiRole: string;
            userRole: string;
            objective: string;
            minimumTurns: number;
            difficulty: string;
            category: string;
        };
        dayKey: string;
        lastActivityAt: Date;
    },
    client: Pick<Database, "conversation"> = db,
) {
    return client.conversation.create({
        data: {
            userId: input.userId,
            scenarioId: input.scenarioId,
            scenarioTitle: input.scenarioSnapshot.title,
            scenarioLanguage: input.scenarioSnapshot.language,
            scenarioAiRole: input.scenarioSnapshot.aiRole,
            scenarioUserRole: input.scenarioSnapshot.userRole,
            scenarioObjective: input.scenarioSnapshot.objective,
            scenarioMinimumTurns: input.scenarioSnapshot.minimumTurns,
            scenarioDifficulty: input.scenarioSnapshot.difficulty as any,
            scenarioCategory: input.scenarioSnapshot.category as any,
            status: CONVERSATION_STATUS.IN_PROGRESS,
            turnCount: 0,
            startedAt: new Date(),
            lastActivityAt: input.lastActivityAt,
            dayKey: input.dayKey,
        },
    });
}

/**
 * Close expired conversations (past inactivity timeout) as EXPIRED.
 * Returns the number of conversations closed.
 */
export async function expireInactiveConversations(
    userId: string,
    inactivityTimeoutMinutes: number,
    now: Date,
) {
    const cutoff = new Date(now.getTime() - inactivityTimeoutMinutes * 60 * 1000);
    const result = await db.conversation.updateMany({
        where: {
            userId,
            status: CONVERSATION_STATUS.IN_PROGRESS,
            lastActivityAt: { lt: cutoff },
        },
        data: {
            status: CONVERSATION_STATUS.EXPIRED,
        },
    });
    return result.count;
}

/**
 * Get conversation with messages for current view.
 */
export async function getConversationWithMessages(conversationId: string, userId: string) {
    return db.conversation.findFirst({
        where: {
            id: conversationId,
            userId,
        },
        include: {
            messages: {
                orderBy: { serverCreatedAt: "asc" },
                select: {
                    id: true,
                    sender: true,
                    content: true,
                    wordCount: true,
                    serverCreatedAt: true,
                    msSincePrevious: true,
                    flagged: true,
                    missingReply: true,
                },
            },
        },
    });
}

/**
 * Get conversation summary for history list.
 */
export async function getConversationHistory(userId: string, limit: number, cursor?: string) {
    const where: any = { userId };
    if (cursor) {
        where.startedAt = { lt: new Date(cursor) };
    }
    return db.conversation.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit + 1,
        select: {
            id: true,
            scenarioTitle: true,
            scenarioDifficulty: true,
            scenarioCategory: true,
            status: true,
            turnCount: true,
            startedAt: true,
            submittedAt: true,
            dayKey: true,
        },
    });
}

/**
 * Find a message by clientMessageId (for idempotency).
 * Returns full message for idempotent replay response.
 */
export async function findMessageByClientId(clientMessageId: string) {
    return db.message.findUnique({
        where: { clientMessageId },
        select: {
            id: true,
            conversationId: true,
            sender: true,
            content: true,
            wordCount: true,
            serverCreatedAt: true,
            msSincePrevious: true,
            flagged: true,
            missingReply: true,
        },
    });
}

/**
 * Get all user messages in a conversation (for duplicate detection).
 */
export async function getUserMessagesInConversation(conversationId: string) {
    return db.message.findMany({
        where: {
            conversationId,
            sender: "USER",
        },
        select: {
            id: true,
            content: true,
            wordCount: true,
        },
        orderBy: { serverCreatedAt: "asc" },
    });
}

/**
 * Count user messages in the last minute (for rate limiting).
 */
export async function countUserMessagesInLastMinute(userId: string, now: Date) {
    const cutoff = new Date(now.getTime() - 60 * 1000);
    return db.message.count({
        where: {
            conversation: { userId },
            sender: "USER",
            serverCreatedAt: { gte: cutoff },
        },
    });
}

// Type for message select result
export type MessageSelectResult = {
    id: string;
    sender: "USER" | "AI";
    content: string;
    wordCount: number;
    serverCreatedAt: Date;
    msSincePrevious: number | null;
    flagged: boolean;
    missingReply: boolean;
};

// Discriminated union for createUserMessage result
type CreateUserMessageResult =
    | { status: "created"; message: MessageSelectResult }
    | { status: "duplicate"; message: MessageSelectResult }
    | { status: "below_min_words" }
    | { status: "exceeds_max_length" };

/**
 * Create a user message with validation.
 * Returns the created message or existing message if clientMessageId already exists (idempotent).
 */
export async function createUserMessage(
    input: {
        conversationId: string;
        clientMessageId: string;
        content: string;
        wordCount: number;
        typingDurationMs?: number;
        pasted?: boolean;
    },
    client: Pick<Database, "message"> = db,
): Promise<CreateUserMessageResult> {
    // Check idempotency
    const existing = await findMessageByClientId(input.clientMessageId);
    if (existing) {
        return { status: "duplicate" as const, message: existing as MessageSelectResult };
    }

    // Validate word count
    if (input.wordCount < TASK_MIN_WORDS_PER_MESSAGE) {
        return { status: "below_min_words" as const };
    }

    // Validate length
    if (input.content.length > TASK_MAX_MESSAGE_LENGTH) {
        return { status: "exceeds_max_length" as const };
    }

    const created = await client.message.create({
        data: {
            conversationId: input.conversationId,
            sender: "USER",
            content: input.content,
            wordCount: input.wordCount,
            clientMessageId: input.clientMessageId,
            typingDurationMs: input.typingDurationMs,
            pasted: input.pasted,
        },
        select: {
            id: true,
            sender: true,
            content: true,
            wordCount: true,
            serverCreatedAt: true,
            msSincePrevious: true,
            flagged: true,
            missingReply: true,
        },
    });

    return { status: "created" as const, message: created as MessageSelectResult };
}

/**
 * Create an AI message (reply).
 */
export async function createAIMessage(
    input: {
        conversationId: string;
        content: string;
        wordCount: number;
        tokensUsed: number;
        missingReply?: boolean;
    },
    client: Pick<Database, "message"> = db,
): Promise<MessageSelectResult> {
    const created = await client.message.create({
        data: {
            conversationId: input.conversationId,
            sender: "AI",
            content: input.content,
            wordCount: input.wordCount,
            missingReply: input.missingReply ?? false,
        },
        select: {
            id: true,
            sender: true,
            content: true,
            wordCount: true,
            serverCreatedAt: true,
            msSincePrevious: true,
            flagged: true,
            missingReply: true,
        },
    });

    return created as MessageSelectResult;
}

/**
 * Update conversation lastActivityAt and increment turnCount.
 */
export async function updateConversationActivity(
    conversationId: string,
    turnCount: number,
    client: Pick<Database, "conversation"> = db,
) {
    return client.conversation.update({
        where: { id: conversationId },
        data: {
            lastActivityAt: new Date(),
            turnCount,
        },
    });
}

/**
 * Find a message by ID (for retry-reply).
 */
export async function findMessageById(messageId: string) {
    return db.message.findUnique({
        where: { id: messageId },
        select: {
            id: true,
            conversationId: true,
            sender: true,
            content: true,
            missingReply: true,
        },
    });
}

/**
 * Calculate similarity between two strings (simple Jaccard on words).
 * Returns value 0-1 where 1 = identical.
 */
export function calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
}

/**
 * Check if a new message is too similar to any existing user message.
 * Checks against ALL existing messages (used for message-level duplicate check when sending).
 */
export function isDuplicateMessage(newContent: string, existingMessages: Array<{ content: string }>): boolean {
    for (const msg of existingMessages) {
        const similarity = calculateSimilarity(newContent, msg.content);
        if (similarity >= TASK_UNIQUENESS_THRESHOLD) {
            return true;
        }
    }
    return false;
}

/**
 * Check if a new message is a duplicate of ANY EARLIER message.
 * Checks only against earlier messages in chronological order (used for conversation-level uniqueness).
 */
export function isDuplicateOfEarlierMessage(
    newContent: string,
    earlierMessages: Array<{ content: string }>
): boolean {
    for (const msg of earlierMessages) {
        const similarity = calculateSimilarity(newContent, msg.content);
        if (similarity >= TASK_UNIQUENESS_THRESHOLD) {
            return true;
        }
    }
    return false;
}

/**
 * Get conversation with all messages for submission checks.
 */
export async function getConversationForSubmission(conversationId: string, userId: string) {
    return db.conversation.findFirst({
        where: {
            id: conversationId,
            userId,
        },
        include: {
            messages: {
                orderBy: { serverCreatedAt: "asc" },
                select: {
                    id: true,
                    sender: true,
                    content: true,
                    wordCount: true,
                    serverCreatedAt: true,
                    flagged: true,
                    missingReply: true,
                },
            },
        },
    });
}

/**
 * Submit conversation - update status and save rules/judge results.
 */
export async function submitConversation(
    conversationId: string,
    input: {
        status: "AUTO_REJECTED" | "PENDING_REVIEW";
        rejectionReasonCodes: string[];
        rulesResult: JsonFieldValue;
        judgeResult: JsonFieldValue;
    },
    client: Pick<Database, "conversation"> = db,
) {
    return client.conversation.update({
        where: { id: conversationId },
        data: {
            status: input.status,
            rejectionReasonCodes: input.rejectionReasonCodes,
            rulesResult: input.rulesResult,
            judgeResult: input.judgeResult,
            submittedAt: new Date(),
        },
        select: {
            id: true,
            status: true,
            submittedAt: true,
            rejectionReasonCodes: true,
            rulesResult: true,
            judgeResult: true,
        },
    });
}

/**
 * Calculate the ratio of unique messages in a conversation.
 * A message is NOT unique if it is an exact or near duplicate (Jaccard >= TASK_UNIQUENESS_THRESHOLD)
 * of an EARLIER user message in the same conversation.
 * Returns uniqueCount / totalCount (ratio 0-1, where 1 = all unique).
 * If 0 or 1 messages, returns 1.
 */
export function calculateUniqueMessageRatio(userMessages: Array<{ content: string }>): number {
    if (userMessages.length <= 1) return 1;

    let uniqueCount = 0;
    // Process messages in chronological order (already sorted by serverCreatedAt ASC)
    for (let i = 0; i < userMessages.length; i++) {
        const currentMessage = userMessages[i]!;
        // Check against earlier messages only
        const earlierMessages = userMessages.slice(0, i);
        if (!isDuplicateOfEarlierMessage(currentMessage.content, earlierMessages)) {
            uniqueCount++;
        }
    }
    return uniqueCount / userMessages.length;
}

/**
 * @deprecated Use calculateUniqueMessageRatio instead.
 * Old conversation-wide uniqueness score: returns the minimum similarity between any two user messages.
 */
export function calculateConversationUniqueness(userMessages: Array<{ content: string }>): number {
    if (userMessages.length < 2) return 1;

    let minSimilarity = 1;
    // userMessages.length >= 2 here, so indices are safe
    for (let i = 0; i < userMessages.length; i++) {
        for (let j = i + 1; j < userMessages.length; j++) {
            const similarity = calculateSimilarity(userMessages[i]!.content, userMessages[j]!.content);
            if (similarity < minSimilarity) {
                minSimilarity = similarity;
            }
        }
    }
    return minSimilarity;
}

/**
 * Count flagged messages ratio.
 */
export function calculateFlaggedRatio(messages: Array<{ flagged: boolean }>): number {
    if (messages.length === 0) return 0;
    const flaggedCount = messages.filter((m) => m.flagged).length;
    return flaggedCount / messages.length;
}