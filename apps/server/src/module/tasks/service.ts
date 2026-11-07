import { db } from "@/services";
import {
    TIERS,
    type TierName,
    TASK_INACTIVITY_TIMEOUT_MINUTES,
    TASK_START_CAP_PER_DAY,
    TASK_MIN_WORDS_PER_MESSAGE,
    TASK_MAX_MESSAGE_LENGTH,
    TASK_UNIQUENESS_THRESHOLD,
    TASK_RATE_LIMIT_MPM,
    TASK_FLAGGED_RATIO_THRESHOLD,
    allowedDifficultiesForTier,
    type UserStatus,
    type OnboardingStatus,
    type Difficulty,
    TASK_REJECTION_REASON,
    TASK_REJECTION_REASON_TEXT,
    CONVERSATION_STATUS,
    getTaskMinExchanges,
} from "@promptpaid/shared";
import {
    setTutorialCompleted,
    findActiveConversation,
    getDailyAllowanceInfo,
    findRandomScenario,
    getScenarioForSnapshot,
    createConversation,
    expireInactiveConversations,
    getConversationWithMessages,
    getConversationHistory as repoGetConversationHistory,
    getDayKeyForTimezone,
    findMessageByClientId,
    getUserMessagesInConversation,
    countUserMessagesInLastMinute,
    createUserMessage,
    createAIMessage,
    updateConversationActivity,
    isDuplicateMessage,
    getConversationForSubmission,
    submitConversation as repoSubmitConversation,
    calculateUniqueMessageRatio,
    calculateFlaggedRatio,
    type MessageSelectResult,
} from "./repo";
import { callAIWithTimeout, type AIReplyInput } from "./ai-adapter";
import {
    canViewTasks,
    canStartConversation,
    canSendMessage,
    canSubmitConversation,
    canCompleteTutorial,
    wrongStatusReply,
    type AccountPosition,
} from "./status-gate";

// --- Result Types ---

export type TutorialCompleteResult =
    | { status: "ok"; alreadyCompleted: boolean; completedAt: Date }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } };

export type TaskSummaryResult =
    | { status: "ok"; tutorialCompleted: boolean; tutorialCompletedAt: Date | null; activeConversation: { id: string; scenarioTitle: string } | null; remainingToday: number; dailyLimit: number; startCapPerDay: number; nextStep: string }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } };

export type StartConversationResult =
    | { status: "ok"; resumed: boolean; conversation: { id: string; title: string; userRole: string; aiRole: string; objective: string; minimumExchanges: number; startedAt: string } }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } }
    | { status: "tutorial_required"; httpStatus: 403; body: { status: "tutorial_required"; message: string; nextStep: string } }
    | { status: "daily_limit"; httpStatus: 403; body: { status: "daily_limit"; message: string; nextStep: string; startedToday: number; dailyLimit: number; startCapPerDay: number } }
    | { status: "no_scenarios"; httpStatus: 503; body: { status: "unavailable"; message: string } };

export type CurrentConversationResult =
    | { status: "ok"; conversation: { id: string; title: string; userRole: string; aiRole: string; objective: string; minimumExchanges: number; startedAt: string; turnCount: number; status: string }; messages: Array<{ id: string; sender: "USER" | "AI"; content: string; wordCount: number; serverCreatedAt: string; msSincePrevious: number | null; flagged: boolean; missingReply: boolean }>; exchangesCompleted: number }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } }
    | { status: "not_found"; httpStatus: 404; body: { status: "not_found"; message: string; nextStep: string } };

export type ConversationHistoryResult =
    | { status: "ok"; conversations: Array<{ id: string; title: string; difficulty: string; category: string; status: string; turnCount: number; startedAt: string; submittedAt: string | null; dayKey: string }>; nextCursor: string | null }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } };

// --- Service Functions ---

/**
 * POST /tasks/tutorial/complete
 * Idempotent: sets tutorialCompletedAt if not set, returns existing if already set.
 */
export async function completeTutorial(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}): Promise<TutorialCompleteResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canCompleteTutorial(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const result = await setTutorialCompleted(input.userId);
    return {
        status: "ok" as const,
        alreadyCompleted: result.alreadyCompleted,
        completedAt: result.completedAt,
    };
}

/**
 * GET /tasks/summary
 * Returns tutorial state, active conversation, remaining daily allowance, next step.
 */
export async function getTaskSummary(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    tier: TierName | null;
    languages: string[];
    timezone: string | null;
}): Promise<TaskSummaryResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canViewTasks(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const user = await db.user.findUnique({
        where: { id: input.userId },
        select: { tutorialCompletedAt: true },
    });

    // Check for active conversation
    const active = await findActiveConversation(input.userId);

    // Compute daily allowance
    const tz = input.timezone ?? "UTC";
    const tierSetting = input.tier ? TIERS[input.tier] : TIERS.ROOKIE;
    const dailyLimit = tierSetting?.dailyConversations ?? TIERS.ROOKIE.dailyConversations;
    const allowance = await getDailyAllowanceInfo(input.userId, tz, dailyLimit, TASK_START_CAP_PER_DAY);

    return {
        status: "ok" as const,
        tutorialCompleted: !!user?.tutorialCompletedAt,
        tutorialCompletedAt: user?.tutorialCompletedAt ?? null,
        activeConversation: active
            ? { id: active.id, scenarioTitle: active.scenarioTitle }
            : null,
        remainingToday: allowance.remaining,
        dailyLimit,
        startCapPerDay: TASK_START_CAP_PER_DAY,
        nextStep: allowance.canStart
            ? "Start a conversation."
            : "Daily limit reached. Try again tomorrow.",
    };
}

/**
 * POST /tasks/start
 * Requires ACTIVATED, tutorial completed, daily allowance available, no active conversation.
 * If active conversation exists, returns it (safe to repeat).
 * Picks random scenario for user's language and allowed difficulties, prefers unseen.
 * Snapshots scenario and returns only user-visible fields.
 * Enforces start cap per day.
 */
export async function startConversation(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    tier: TierName | null;
    languages: string[];
    timezone: string | null;
}): Promise<StartConversationResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canStartConversation(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const user = await db.user.findUnique({
        where: { id: input.userId },
        select: { tutorialCompletedAt: true },
    });
    if (!user?.tutorialCompletedAt) {
        return {
            status: "tutorial_required" as const,
            httpStatus: 403 as const,
            body: {
                status: "tutorial_required" as const,
                message: "Complete the onboarding tutorial before starting tasks.",
                nextStep: "Complete the onboarding tutorial, then start tasks.",
            },
        };
    }

    const now = new Date();

    // First, expire any inactive conversations
    await expireInactiveConversations(input.userId, TASK_INACTIVITY_TIMEOUT_MINUTES, now);

    // Check for existing active conversation (after expiry)
    const existing = await findActiveConversation(input.userId);
    if (existing) {
        return {
            status: "ok" as const,
            resumed: true,
            conversation: {
                id: existing.id,
                title: existing.scenarioTitle,
                userRole: existing.scenarioUserRole,
                aiRole: existing.scenarioAiRole,
                objective: existing.scenarioObjective,
                minimumExchanges: existing.scenarioMinimumTurns,
                startedAt: existing.startedAt.toISOString(),
            },
        };
    }

    // Check daily allowance
    const tz = input.timezone ?? "UTC";
    const tierSetting = input.tier ? TIERS[input.tier] : TIERS.ROOKIE;
    const dailyLimit = tierSetting?.dailyConversations ?? TIERS.ROOKIE.dailyConversations;
    const allowance = await getDailyAllowanceInfo(input.userId, tz, dailyLimit, TASK_START_CAP_PER_DAY);

    if (!allowance.canStart) {
        return {
            status: "daily_limit" as const,
            httpStatus: 403 as const,
            body: {
                status: "daily_limit" as const,
                message: `You have reached your daily limit of ${dailyLimit} conversations (cap: ${TASK_START_CAP_PER_DAY}).`,
                nextStep: "Try again tomorrow.",
                startedToday: allowance.startedToday,
                dailyLimit,
                startCapPerDay: TASK_START_CAP_PER_DAY,
            },
        };
    }

    // Pick scenario
    const language = input.languages[0] ?? "english";
    const allowedDifficulties = input.tier
        ? allowedDifficultiesForTier(input.tier)
        : allowedDifficultiesForTier("ROOKIE");

    const scenarioId = await findRandomScenario(input.userId, language, allowedDifficulties);
    if (!scenarioId) {
        return {
            status: "no_scenarios" as const,
            httpStatus: 503 as const,
            body: {
                status: "unavailable" as const,
                message: "No scenarios available for your language and tier. Please try again later.",
            },
        };
    }

    const scenario = await getScenarioForSnapshot(scenarioId);
    if (!scenario) {
        return {
            status: "no_scenarios" as const,
            httpStatus: 503 as const,
            body: {
                status: "unavailable" as const,
                message: "Scenario not found. Please try again.",
            },
        };
    }

    const dayKey = getDayKeyForTimezone(tz);

    const created = await db.$transaction(
        async (tx) => {
            return createConversation(
                {
                    userId: input.userId,
                    scenarioId,
                    scenarioSnapshot: {
                        title: scenario.title,
                        language: scenario.language,
                        aiRole: scenario.aiRole,
                        userRole: scenario.userRole,
                        objective: scenario.objective,
                        minimumTurns: scenario.minimumTurns,
                        difficulty: scenario.difficulty,
                        category: scenario.category,
                    },
                    dayKey,
                    lastActivityAt: now,
                },
                tx,
            );
        },
        { timeout: 15000 },
    );

    return {
        status: "ok" as const,
        resumed: false,
        conversation: {
            id: created.id,
            title: created.scenarioTitle,
            userRole: created.scenarioUserRole,
            aiRole: created.scenarioAiRole,
            objective: created.scenarioObjective,
            minimumExchanges: created.scenarioMinimumTurns,
            startedAt: created.startedAt.toISOString(),
        },
    };
}

/**
 * GET /tasks/current
 * Returns snapshot-safe conversation, all messages, and exchanges completed.
 */
export async function getCurrentConversation(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    conversationId: string;
}): Promise<CurrentConversationResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canSendMessage(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const conv = await getConversationWithMessages(input.conversationId, input.userId);
    if (!conv) {
        return {
            status: "not_found" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "Conversation not found.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    // Count exchanges (pairs of USER + AI messages)
    let exchangesCompleted = 0;
    let lastWasUser = false;
    for (const msg of conv.messages) {
        if (msg.sender === "USER") {
            lastWasUser = true;
        } else if (msg.sender === "AI" && lastWasUser) {
            exchangesCompleted++;
            lastWasUser = false;
        } else {
            lastWasUser = false;
        }
    }

    return {
        status: "ok" as const,
        conversation: {
            id: conv.id,
            title: conv.scenarioTitle,
            userRole: conv.scenarioUserRole,
            aiRole: conv.scenarioAiRole,
            objective: conv.scenarioObjective,
            minimumExchanges: conv.scenarioMinimumTurns,
            startedAt: conv.startedAt.toISOString(),
            turnCount: conv.turnCount,
            status: conv.status,
        },
        messages: conv.messages.map((msg) => ({
            id: msg.id,
            sender: msg.sender as "USER" | "AI",
            content: msg.content,
            wordCount: msg.wordCount,
            serverCreatedAt: msg.serverCreatedAt.toISOString(),
            msSincePrevious: msg.msSincePrevious,
            flagged: msg.flagged,
            missingReply: msg.missingReply,
        })),
        exchangesCompleted,
    };
}

/**
 * GET /tasks/history
 * Returns short list of user's conversations with statuses.
 */
export async function getConversationHistory(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    limit: number;
    cursor?: string;
}): Promise<ConversationHistoryResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canViewTasks(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const conversations = await repoGetConversationHistory(input.userId, input.limit, input.cursor);
    const hasMore = conversations.length > input.limit;
    const items = hasMore ? conversations.slice(0, input.limit) : conversations;
    // items has at least one element when hasMore is true because input.limit >= 1
    const nextCursor = hasMore
        ? items[items.length - 1]!.startedAt.toISOString()
        : null;

    return {
        status: "ok" as const,
        conversations: items.map((c) => ({
            id: c.id,
            title: c.scenarioTitle,
            difficulty: c.scenarioDifficulty,
            category: c.scenarioCategory,
            status: c.status,
            turnCount: c.turnCount,
            startedAt: c.startedAt.toISOString(),
            submittedAt: c.submittedAt?.toISOString() ?? null,
            dayKey: c.dayKey,
        })),
        nextCursor,
    };
}

// --- Result Types for Messages ---

export type SendMessageResult =
    | { status: "ok"; message: { id: string; sender: "USER" | "AI"; content: string; wordCount: number; serverCreatedAt: string; msSincePrevious: number | null; flagged: boolean; missingReply: boolean }; aiReply: { id: string; sender: "AI"; content: string; wordCount: number; serverCreatedAt: string; msSincePrevious: number | null; flagged: boolean; missingReply: boolean } | null; exchangesCompleted: number; conversationStatus: string }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } }
    | { status: "not_found"; httpStatus: 404; body: { status: "not_found"; message: string; nextStep: string } }
    | { status: "conversation_ended"; httpStatus: 409; body: { status: "conversation_ended"; message: string; nextStep: string } }
    | { status: "rate_limited"; httpStatus: 429; body: { status: "rate_limited"; message: string; retryAfterSeconds: number } }
    | { status: "below_min_words"; httpStatus: 400; body: { status: "below_min_words"; message: string } }
    | { status: "exceeds_max_length"; httpStatus: 400; body: { status: "exceeds_max_length"; message: string } }
    | { status: "duplicate_message"; httpStatus: 409; body: { status: "duplicate_message"; message: string } }
    | { status: "idempotent_replay"; httpStatus: 200; body: { status: "idempotent_replay"; message: string; originalMessage: { id: string; sender: "USER" | "AI"; content: string; wordCount: number; serverCreatedAt: string; msSincePrevious: number | null; flagged: boolean; missingReply: boolean } } };

export type RetryReplyResult =
    | { status: "ok"; aiReply: { id: string; sender: "AI"; content: string; wordCount: number; serverCreatedAt: string; msSincePrevious: number | null; flagged: boolean; missingReply: boolean }; exchangesCompleted: number; conversationStatus: string }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } }
    | { status: "not_found"; httpStatus: 404; body: { status: "not_found"; message: string; nextStep: string } }
    | { status: "no_missing_reply"; httpStatus: 400; body: { status: "no_missing_reply"; message: string } }
    | { status: "conversation_ended"; httpStatus: 409; body: { status: "conversation_ended"; message: string; nextStep: string } };

/**
 * POST /tasks/message
 * Send a user message, validate, save idempotently, call AI adapter, save AI reply.
 */
export async function sendMessage(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    conversationId: string;
    clientMessageId: string;
    content: string;
    typingDurationMs?: number;
    pasted?: boolean;
}): Promise<SendMessageResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canSendMessage(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const now = new Date();

    // 1. Get conversation with messages
    const conv = await getConversationWithMessages(input.conversationId, input.userId);
    if (!conv) {
        return {
            status: "not_found" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "Conversation not found.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    // 2. Check conversation is still in progress
    if (conv.status !== CONVERSATION_STATUS.IN_PROGRESS) {
        return {
            status: "conversation_ended" as const,
            httpStatus: 409 as const,
            body: {
                status: "conversation_ended" as const,
                message: "This conversation has ended and cannot accept new messages.",
                nextStep: "Start a new conversation.",
            },
        };
    }

    // 3. Check rate limit (user messages per minute)
    const recentCount = await countUserMessagesInLastMinute(input.userId, now);
    if (recentCount >= TASK_RATE_LIMIT_MPM) {
        return {
            status: "rate_limited" as const,
            httpStatus: 429 as const,
            body: {
                status: "rate_limited" as const,
                message: `Rate limit exceeded. Max ${TASK_RATE_LIMIT_MPM} messages per minute.`,
                retryAfterSeconds: 60,
            },
        };
    }

    // 4. Check for duplicate clientMessageId (idempotency)
    const existingByClientId = await findMessageByClientId(input.clientMessageId);
    if (existingByClientId) {
        // Return the existing message for idempotent replay
        const existingMsg = conv.messages.find((m) => m.id === existingByClientId.id);
        if (existingMsg) {
            return {
                status: "idempotent_replay" as const,
                httpStatus: 200 as const,
                body: {
                    status: "idempotent_replay" as const,
                    message: "Message already processed.",
                    originalMessage: {
                        id: existingMsg.id,
                        sender: existingMsg.sender as "USER" | "AI",
                        content: existingMsg.content,
                        wordCount: existingMsg.wordCount,
                        serverCreatedAt: existingMsg.serverCreatedAt.toISOString(),
                        msSincePrevious: existingMsg.msSincePrevious,
                        flagged: existingMsg.flagged,
                        missingReply: existingMsg.missingReply,
                    },
                },
            };
        }
    }

    // 5. Validate message content
    const wordCount = input.content.trim().split(/\s+/).filter((w) => w.length > 0).length;

    if (wordCount < TASK_MIN_WORDS_PER_MESSAGE) {
        return {
            status: "below_min_words" as const,
            httpStatus: 400 as const,
            body: {
                status: "below_min_words" as const,
                message: TASK_REJECTION_REASON_TEXT.BELOW_MIN_WORDS,
            },
        };
    }

    if (input.content.length > TASK_MAX_MESSAGE_LENGTH) {
        return {
            status: "exceeds_max_length" as const,
            httpStatus: 400 as const,
            body: {
                status: "exceeds_max_length" as const,
                message: TASK_REJECTION_REASON_TEXT.EXCEEDS_MAX_LENGTH,
            },
        };
    }

    // 6. Check for duplicate content (similarity)
    const userMessages = await getUserMessagesInConversation(input.conversationId);
    if (isDuplicateMessage(input.content, userMessages)) {
        return {
            status: "duplicate_message" as const,
            httpStatus: 409 as const,
            body: {
                status: "duplicate_message" as const,
                message: TASK_REJECTION_REASON_TEXT.DUPLICATE_MESSAGE,
            },
        };
    }

    // 7. Save user message (in transaction)
    let userMessage: Awaited<ReturnType<typeof createUserMessage>> | null = null;
    await db.$transaction(async (tx) => {
        userMessage = await createUserMessage(
            {
                conversationId: input.conversationId,
                clientMessageId: input.clientMessageId,
                content: input.content,
                wordCount,
                typingDurationMs: input.typingDurationMs,
                pasted: input.pasted,
            },
            tx,
        );
    }, { timeout: 10000 });

    // userMessage is guaranteed to be set after the transaction
    const userMessageResult = userMessage!;

    if (userMessageResult.status === "duplicate") {
        // Should not happen since we checked above, but handle anyway
        const existingMsg = conv.messages.find((m) => m.id === userMessageResult.message.id);
        if (!existingMsg) {
            // Fallback - shouldn't happen
            const dupMsg = userMessageResult.message;
            return {
                status: "ok" as const,
                message: {
                    id: dupMsg.id,
                    sender: "USER" as const,
                    content: dupMsg.content,
                    wordCount: dupMsg.wordCount,
                    serverCreatedAt: dupMsg.serverCreatedAt.toISOString(),
                    msSincePrevious: dupMsg.msSincePrevious,
                    flagged: dupMsg.flagged,
                    missingReply: dupMsg.missingReply,
                },
                aiReply: null,
                exchangesCompleted: 0,
                conversationStatus: conv.status,
            };
        }
        return {
            status: "idempotent_replay" as const,
            httpStatus: 200 as const,
            body: {
                status: "idempotent_replay" as const,
                message: "Message already processed.",
                originalMessage: {
                    id: existingMsg.id,
                    sender: existingMsg.sender as "USER" | "AI",
                    content: existingMsg.content,
                    wordCount: existingMsg.wordCount,
                    serverCreatedAt: existingMsg.serverCreatedAt.toISOString(),
                    msSincePrevious: existingMsg.msSincePrevious,
                    flagged: existingMsg.flagged,
                    missingReply: existingMsg.missingReply,
                },
            },
        };
    }

    if (userMessageResult.status === "below_min_words") {
        return {
            status: "below_min_words" as const,
            httpStatus: 400 as const,
            body: {
                status: "below_min_words" as const,
                message: TASK_REJECTION_REASON_TEXT.BELOW_MIN_WORDS,
            },
        };
    }

    if (userMessageResult.status === "exceeds_max_length") {
        return {
            status: "exceeds_max_length" as const,
            httpStatus: 400 as const,
            body: {
                status: "exceeds_max_length" as const,
                message: TASK_REJECTION_REASON_TEXT.EXCEEDS_MAX_LENGTH,
            },
        };
    }

    // At this point, userMessageResult.status === "created" and message has full properties
    const savedUserMsg = userMessageResult.message;

    // 8. Call AI adapter OUTSIDE transaction
    const conversationHistory = conv.messages.map((m) => ({
        sender: m.sender as "USER" | "AI",
        content: m.content,
    }));
    // Add the new user message to history for AI context
    conversationHistory.push({ sender: "USER" as const, content: input.content });

    // Calculate total tokens used so far
    const totalTokensUsed = conv.messages
        .filter((m) => m.sender === "AI")
        .reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

    const aiInput: AIReplyInput = {
        scenarioSnapshot: {
            title: conv.scenarioTitle,
            language: conv.scenarioLanguage,
            aiRole: conv.scenarioAiRole,
            userRole: conv.scenarioUserRole,
            objective: conv.scenarioObjective,
            minimumTurns: conv.scenarioMinimumTurns,
            difficulty: conv.scenarioDifficulty as Difficulty,
            category: conv.scenarioCategory,
        },
        conversationHistory,
        userMessage: input.content,
        totalTokensUsedSoFar: totalTokensUsed,
    };

    const aiResult = await callAIWithTimeout(aiInput);

    // 9. Save AI reply (in transaction)
    let aiReplyMessage: MessageSelectResult | null = null;
    let newTurnCount = conv.turnCount + 1; // user message + AI reply = 1 exchange = 2 turns

    await db.$transaction(async (tx) => {
        if (aiResult.status === "ok") {
            // Save successful AI reply
            aiReplyMessage = await createAIMessage(
                {
                    conversationId: input.conversationId,
                    content: aiResult.reply.content,
                    wordCount: aiResult.reply.content.trim().split(/\s+/).filter((w) => w.length > 0).length,
                    tokensUsed: aiResult.reply.tokensUsed,
                    missingReply: false,
                },
                tx,
            );
        } else {
            // Save missing reply marker
            const missingContent = aiResult.status === "timeout"
                ? "AI reply timed out. You can retry."
                : "AI reply failed. You can retry.";
            aiReplyMessage = await createAIMessage(
                {
                    conversationId: input.conversationId,
                    content: missingContent,
                    wordCount: missingContent.trim().split(/\s+/).filter((w) => w.length > 0).length,
                    tokensUsed: 0,
                    missingReply: true,
                },
                tx,
            );
        }

        // Update conversation activity and turn count
        await updateConversationActivity(input.conversationId, newTurnCount, tx);
    }, { timeout: 10000 });

    // aiReplyMessage is guaranteed to be set after the transaction
    const aiReply = aiReplyMessage!;

    // 10. Calculate exchanges completed
    let exchangesCompleted = 0;
    let lastWasUser = false;
    const allMessages = [...conv.messages, savedUserMsg!];
    allMessages.push(aiReply);
    for (const msg of allMessages) {
        if (msg.sender === "USER") {
            lastWasUser = true;
        } else if (msg.sender === "AI" && lastWasUser) {
            exchangesCompleted++;
            lastWasUser = false;
        } else {
            lastWasUser = false;
        }
    }

    // Prepare response
    const userMsgResponse = {
        id: savedUserMsg!.id,
        sender: "USER" as const,
        content: savedUserMsg!.content,
        wordCount: savedUserMsg!.wordCount,
        serverCreatedAt: savedUserMsg!.serverCreatedAt.toISOString(),
        msSincePrevious: savedUserMsg!.msSincePrevious,
        flagged: savedUserMsg!.flagged,
        missingReply: savedUserMsg!.missingReply,
    };

    let aiMsgResponse = null;
    if (aiReply) {
        aiMsgResponse = {
            id: aiReply.id,
            sender: "AI" as const,
            content: aiReply.content,
            wordCount: aiReply.wordCount,
            serverCreatedAt: aiReply.serverCreatedAt.toISOString(),
            msSincePrevious: aiReply.msSincePrevious,
            flagged: aiReply.flagged,
            missingReply: aiReply.missingReply,
        };
    }

    return {
        status: "ok" as const,
        message: userMsgResponse,
        aiReply: aiMsgResponse,
        exchangesCompleted,
        conversationStatus: conv.status,
    };
}

/**
 * POST /tasks/retry-reply
 * Retry a failed AI reply (message with missingReply=true).
 */
export async function retryReply(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    conversationId: string;
}): Promise<RetryReplyResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canSendMessage(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    // 1. Get conversation
    const conv = await getConversationWithMessages(input.conversationId, input.userId);
    if (!conv) {
        return {
            status: "not_found" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "Conversation not found.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    // 2. Check conversation is still in progress
    if (conv.status !== CONVERSATION_STATUS.IN_PROGRESS) {
        return {
            status: "conversation_ended" as const,
            httpStatus: 409 as const,
            body: {
                status: "conversation_ended" as const,
                message: "This conversation has ended.",
                nextStep: "Start a new conversation.",
            },
        };
    }

    // 3. Find the last AI message with missingReply=true
    const missingReplyMsg = conv.messages
        .filter((m) => m.sender === "AI" && m.missingReply)
        .pop();

    if (!missingReplyMsg) {
        return {
            status: "no_missing_reply" as const,
            httpStatus: 400 as const,
            body: {
                status: "no_missing_reply" as const,
                message: "No failed AI reply to retry.",
            },
        };
    }

    // 4. Find the user message that preceded it (the one that triggered the failed reply)
    const userMsgIndex = conv.messages.findIndex((m) => m.id === missingReplyMsg.id) - 1;
    if (userMsgIndex < 0) {
        return {
            status: "no_missing_reply" as const,
            httpStatus: 400 as const,
            body: {
                status: "no_missing_reply" as const,
                message: "Cannot find user message to retry.",
            },
        };
    }
    const userMsg = conv.messages[userMsgIndex];
    if (!userMsg) {
        return {
            status: "no_missing_reply" as const,
            httpStatus: 400 as const,
            body: {
                status: "no_missing_reply" as const,
                message: "Cannot find user message to retry.",
            },
        };
    }

    // 5. Call AI adapter OUTSIDE transaction
    const conversationHistory = conv.messages
        .slice(0, userMsgIndex + 1) // Up to and including the user message
        .map((m) => ({ sender: m.sender as "USER" | "AI", content: m.content }));

    // Calculate total tokens used so far (excluding the failed reply)
    const totalTokensUsed = conv.messages
        .filter((m) => m.sender === "AI" && !m.missingReply)
        .reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

    const aiInput: AIReplyInput = {
        scenarioSnapshot: {
            title: conv.scenarioTitle,
            language: conv.scenarioLanguage,
            aiRole: conv.scenarioAiRole,
            userRole: conv.scenarioUserRole,
            objective: conv.scenarioObjective,
            minimumTurns: conv.scenarioMinimumTurns,
            difficulty: conv.scenarioDifficulty as Difficulty,
            category: conv.scenarioCategory,
        },
        conversationHistory,
        userMessage: userMsg.content,
        totalTokensUsedSoFar: totalTokensUsed,
    };

    const aiResult = await callAIWithTimeout(aiInput);

    // 6. Replace the missing reply with new reply (in transaction)
    let newAiReply: Awaited<ReturnType<typeof createAIMessage>> | null = null;
    await db.$transaction(async (tx) => {
        // Delete the old missing reply
        await tx.message.delete({ where: { id: missingReplyMsg.id } });

        // Create new AI reply
        if (aiResult.status === "ok") {
            newAiReply = await createAIMessage(
                {
                    conversationId: input.conversationId,
                    content: aiResult.reply.content,
                    wordCount: aiResult.reply.content.trim().split(/\s+/).filter((w) => w.length > 0).length,
                    tokensUsed: aiResult.reply.tokensUsed,
                    missingReply: false,
                },
                tx,
            );
        } else {
            const missingContent = aiResult.status === "timeout"
                ? "AI reply timed out. You can retry."
                : "AI reply failed. You can retry.";
            newAiReply = await createAIMessage(
                {
                    conversationId: input.conversationId,
                    content: missingContent,
                    wordCount: missingContent.trim().split(/\s+/).filter((w) => w.length > 0).length,
                    tokensUsed: 0,
                    missingReply: true,
                },
                tx,
            );
        }

        // Update conversation activity
        await updateConversationActivity(input.conversationId, conv.turnCount, tx);
    }, { timeout: 10000 });

    // newAiReply is guaranteed to be assigned in both branches above
    const aiReply = newAiReply!;

    // 7. Calculate exchanges completed
    let exchangesCompleted = 0;
    let lastWasUser = false;
    for (const msg of conv.messages) {
        if (msg.id === missingReplyMsg.id) continue; // Skip old missing reply
        if (msg.sender === "USER") {
            lastWasUser = true;
        } else if (msg.sender === "AI" && lastWasUser) {
            exchangesCompleted++;
            lastWasUser = false;
        } else {
            lastWasUser = false;
        }
    }
    // Count the new reply if it completes an exchange
    if (aiReply.sender === "AI" && lastWasUser && !aiReply.missingReply) {
        exchangesCompleted++;
    }

    const aiMsgResponse = {
        id: aiReply.id,
        sender: "AI" as const,
        content: aiReply.content,
        wordCount: aiReply.wordCount,
        serverCreatedAt: aiReply.serverCreatedAt.toISOString(),
        msSincePrevious: aiReply.msSincePrevious,
        flagged: aiReply.flagged,
        missingReply: aiReply.missingReply,
    };

    return {
        status: "ok" as const,
        aiReply: aiMsgResponse,
        exchangesCompleted,
        conversationStatus: conv.status,
    };
}

// --- Result Types for Submit ---

export type SubmitConversationResult =
    | { status: "ok"; conversation: { id: string; status: string; submittedAt: string; rejectionReasonCodes: string[]; rulesResult: Record<string, unknown> } }
    | { status: "wrong_status"; httpStatus: 409; body: { status: "wrong_status"; message: string; nextStep: string } }
    | { status: "not_found"; httpStatus: 404; body: { status: "not_found"; message: string; nextStep: string } }
    | { status: "conversation_ended"; httpStatus: 409; body: { status: "conversation_ended"; message: string; nextStep: string } }
    | { status: "below_min_exchanges"; httpStatus: 400; body: { status: "below_min_exchanges"; message: string; exchangesCompleted: number; minimumExchanges: number } }
    | { status: "missing_reply"; httpStatus: 400; body: { status: "missing_reply"; message: string; retryAvailable: true } };

/**
 * POST /tasks/submit
 * Runs automatic checks:
 * - Missing reply check (must not have any AI message with missingReply=true)
 * - Minimum exchanges (12, or dev override)
 * - Conversation-wide uniqueness (>= 90% unique messages)
 * - Flagged ratio (max 0.3)
 * - Fake judge evaluation (stored internally, never influences status)
 * Auto-rejects if any check fails, otherwise marks PENDING_REVIEW.
 */
export async function submitConversation(input: {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    conversationId: string;
}): Promise<SubmitConversationResult> {
    const position: AccountPosition = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };
    if (!canSubmitConversation(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    // 1. Get conversation with messages
    const conv = await getConversationForSubmission(input.conversationId, input.userId);
    if (!conv) {
        return {
            status: "not_found" as const,
            httpStatus: 404 as const,
            body: {
                status: "not_found" as const,
                message: "Conversation not found.",
                nextStep: wrongStatusReply(position).body.nextStep,
            },
        };
    }

    // 2. Check conversation is still in progress
    if (conv.status !== CONVERSATION_STATUS.IN_PROGRESS) {
        return {
            status: "conversation_ended" as const,
            httpStatus: 409 as const,
            body: {
                status: "conversation_ended" as const,
                message: "This conversation has already been submitted or ended.",
                nextStep: "Start a new conversation.",
            },
        };
    }

    // 3. Check for missing AI replies - provider failure must not penalize trainer
    const aiMessages = conv.messages.filter((m) => m.sender === "AI");
    const hasMissingReply = aiMessages.some((m) => m.missingReply === true);
    if (hasMissingReply) {
        return {
            status: "missing_reply" as const,
            httpStatus: 400 as const,
            body: {
                status: "missing_reply" as const,
                message: "Your last reply is still missing. Please retry before submitting.",
                retryAvailable: true,
            },
        };
    }

    // 4. Count exchanges (user + AI pairs)
    let exchangesCompleted = 0;
    let lastWasUser = false;
    for (const msg of conv.messages) {
        if (msg.sender === "USER") {
            lastWasUser = true;
        } else if (msg.sender === "AI" && lastWasUser) {
            exchangesCompleted++;
            lastWasUser = false;
        } else {
            lastWasUser = false;
        }
    }

    // 5. Check minimum exchanges (using getTaskMinExchanges for dev override support)
    const minimumExchanges = getTaskMinExchanges();
    if (exchangesCompleted < minimumExchanges) {
        return {
            status: "below_min_exchanges" as const,
            httpStatus: 400 as const,
            body: {
                status: "below_min_exchanges" as const,
                message: TASK_REJECTION_REASON_TEXT.BELOW_MIN_EXCHANGES,
                exchangesCompleted,
                minimumExchanges,
            },
        };
    }

    // 6. Collect rejection reasons from automatic rule checks only
    const rejectionReasons: string[] = [];

    // 6a. Conversation-wide uniqueness check (require >= 90% unique messages)
    const userMessages = conv.messages.filter((m) => m.sender === "USER");
    const uniquenessRatio = calculateUniqueMessageRatio(userMessages);
    if (uniquenessRatio < 0.9) {
        rejectionReasons.push(TASK_REJECTION_REASON.UNIQUENESS_BELOW_THRESHOLD);
    }

    // 6b. Flagged ratio check
    const flaggedRatio = calculateFlaggedRatio(conv.messages);
    if (flaggedRatio > TASK_FLAGGED_RATIO_THRESHOLD) {
        rejectionReasons.push(TASK_REJECTION_REASON.FLAGGED_RATIO_EXCEEDED);
    }

    // 6c. Fake judge evaluation (stored internally, never influences status)
    const judgeResult = await fakeJudgeEvaluation(conv, exchangesCompleted);

    // 7. Determine final status based ONLY on rule checks (not judge)
    const finalStatus = rejectionReasons.length > 0
        ? CONVERSATION_STATUS.AUTO_REJECTED
        : CONVERSATION_STATUS.PENDING_REVIEW;

    // 8. Prepare rulesResult (judge result is stored in DB but not returned to client)
    const rulesResult = {
        exchangesCompleted,
        minimumExchanges,
        uniquenessRatio,
        uniquenessThreshold: 0.9,
        flaggedRatio,
        flaggedRatioThreshold: TASK_FLAGGED_RATIO_THRESHOLD,
        rejectionReasons,
    };

    // 9. Save submission in transaction
    const submitted = await db.$transaction(async (tx) => {
        return repoSubmitConversation(
            input.conversationId,
            {
                status: finalStatus,
                rejectionReasonCodes: rejectionReasons,
                rulesResult,
                judgeResult: judgeResult.details, // Store judge details internally only
            },
            tx,
        );
    }, { timeout: 10000 });

    return {
        status: "ok" as const,
        conversation: {
            id: submitted.id,
            status: submitted.status,
            submittedAt: submitted.submittedAt!.toISOString(),
            rejectionReasonCodes: submitted.rejectionReasonCodes,
            rulesResult: submitted.rulesResult as Record<string, unknown>,
        },
    };
}

/**
 * Fake judge evaluation - simulates AI judge for development.
 * In production, this would call an actual LLM judge.
 *
 * NOTE: The judge output is stored internally but NEVER influences the final status.
 * Only the rule checks (min exchanges, uniqueness >= 90%, flagged ratio <= 30%) decide the outcome.
 */
async function fakeJudgeEvaluation(
    conv: NonNullable<Awaited<ReturnType<typeof getConversationForSubmission>>>,
    exchangesCompleted: number,
): Promise<{ status: "pass" | "reject"; reasonCodes: string[]; details: Record<string, unknown> }> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 500));

    // Simple heuristic: check if conversation seems coherent
    const userMessages = conv.messages.filter((m) => m.sender === "USER");
    const aiMessages = conv.messages.filter((m) => m.sender === "AI");

    // Check for very short responses that might indicate low effort
    const avgUserWords = userMessages.reduce((sum, m) => sum + m.wordCount, 0) / userMessages.length;
    const avgAiWords = aiMessages.reduce((sum, m) => sum + m.wordCount, 0) / (aiMessages.length || 1);

    // NOTE: We do NOT check for missing replies here - that's checked BEFORE calling the judge
    // and missing replies result in a retryable error, not a rejection.
    // The judge evaluation is purely informational and never influences the outcome.

    // Always pass - judge never rejects (status only stored internally)
    // The reasonCodes array is kept for informational purposes in the stored details
    const reasonCodes: string[] = [];
    const status: "pass" | "reject" = "pass";

    return {
        status,
        reasonCodes,
        details: {
            avgUserWords,
            avgAiWords,
            exchangesCompleted,
            evaluatedAt: new Date().toISOString(),
        },
    };
}