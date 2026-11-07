import { Router } from "express";
import { z } from "zod";
import {
    tutorialCompleteSchema,
    taskStartSchema,
    taskCurrentSchema,
    taskHistorySchema,
    taskMessageSchema,
    taskRetryReplySchema,
    taskSubmitSchema,
    type UserStatus,
    type OnboardingStatus,
    type TierName,
} from "@promptpaid/shared";
import { requireAuth } from "@/middleware/auth";
import { requireSameOrigin, requireJson } from "@/middleware/security";
import {
    completeTutorial,
    getTaskSummary,
    startConversation,
    getCurrentConversation,
    getConversationHistory,
    sendMessage,
    retryReply,
    submitConversation,
    type TutorialCompleteResult,
    type TaskSummaryResult,
    type StartConversationResult,
    type CurrentConversationResult,
    type ConversationHistoryResult,
    type SendMessageResult,
    type RetryReplyResult,
    type SubmitConversationResult,
} from "@/module/tasks";

const router = Router();

/**
 * POST /tasks/tutorial/complete
 * Idempotent: sets tutorialCompletedAt once; repeating returns existing timestamp.
 */
router.post("/tutorial/complete", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = tutorialCompleteSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: TutorialCompleteResult = await completeTutorial({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            alreadyCompleted: result.alreadyCompleted,
            completedAt: result.completedAt.toISOString(),
        });
    } catch (err) {
        console.error("complete tutorial failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * GET /tasks/summary
 * Returns tutorial state, active conversation, remaining daily allowance, next step.
 */
router.get("/summary", requireAuth, async (req, res) => {
    try {
        const user = req.user!;
        const result: TaskSummaryResult = await getTaskSummary({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            tier: user.tier as TierName | null,
            languages: user.languages,
            timezone: user.timezone,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            tutorialCompleted: result.tutorialCompleted,
            tutorialCompletedAt: result.tutorialCompletedAt?.toISOString() ?? null,
            activeConversation: result.activeConversation,
            remainingToday: result.remainingToday,
            dailyLimit: result.dailyLimit,
            startCapPerDay: result.startCapPerDay,
            nextStep: result.nextStep,
        });
    } catch (err) {
        console.error("get task summary failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * POST /tasks/start
 * Requires ACTIVATED, tutorial completed, daily allowance available, no active conversation.
 * If active conversation exists, returns it (safe to repeat).
 * Picks random scenario for user's language and allowed difficulties, prefers unseen.
 * Snapshots scenario and returns only user-visible fields.
 * Enforces start cap per day.
 */
router.post("/start", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = taskStartSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: StartConversationResult = await startConversation({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            tier: user.tier as TierName | null,
            languages: user.languages,
            timezone: user.timezone,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "tutorial_required") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "daily_limit") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "no_scenarios") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(result.resumed ? 200 : 201).json({
            status: "ok",
            resumed: result.resumed,
            conversation: result.conversation,
        });
    } catch (err) {
        console.error("start conversation failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * GET /tasks/current
 * Returns snapshot-safe conversation, all messages, and exchanges completed.
 * Uses query param for conversationId.
 */
router.get("/current", requireAuth, async (req, res) => {
    try {
        const parsed = taskCurrentSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: CurrentConversationResult = await getCurrentConversation({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            conversationId: parsed.data.conversationId,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "not_found") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            conversation: result.conversation,
            messages: result.messages,
            exchangesCompleted: result.exchangesCompleted,
        });
    } catch (err) {
        console.error("get current conversation failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * GET /tasks/history
 * Returns short list of user's conversations with statuses.
 */
router.get("/history", requireAuth, async (req, res) => {
    try {
        const parsed = taskHistorySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: ConversationHistoryResult = await getConversationHistory({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            limit: parsed.data.limit,
            cursor: parsed.data.cursor,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            conversations: result.conversations,
            nextCursor: result.nextCursor,
        });
    } catch (err) {
        console.error("get conversation history failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * POST /tasks/message
 * Send a user message in an active conversation.
 * Validates: min words, max length, duplicate detection, rate limiting.
 * Saves user message idempotently (clientMessageId), calls AI adapter, saves AI reply.
 * Returns both messages and updated exchange count.
 */
router.post("/message", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = taskMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: SendMessageResult = await sendMessage({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            conversationId: parsed.data.conversationId,
            clientMessageId: parsed.data.clientMessageId,
            content: parsed.data.content,
            typingDurationMs: parsed.data.typingDurationMs,
            pasted: parsed.data.pasted,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "not_found") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "conversation_ended") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "rate_limited") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "below_min_words") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "exceeds_max_length") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "duplicate_message") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "idempotent_replay") {
            return res.status(result.httpStatus).json(result.body);
        }

        // status === "ok"
        return res.status(200).json({
            status: "ok",
            message: result.message,
            aiReply: result.aiReply,
            exchangesCompleted: result.exchangesCompleted,
            conversationStatus: result.conversationStatus,
        });
    } catch (err) {
        console.error("send message failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * POST /tasks/retry-reply
 * Retry a failed AI reply (message with missingReply=true).
 * Finds the last failed AI reply, re-calls AI adapter, replaces the missing reply.
 */
router.post("/retry-reply", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = taskRetryReplySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: RetryReplyResult = await retryReply({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            conversationId: parsed.data.conversationId,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "not_found") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "no_missing_reply") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "conversation_ended") {
            return res.status(result.httpStatus).json(result.body);
        }

        // status === "ok"
        return res.status(200).json({
            status: "ok",
            aiReply: result.aiReply,
            exchangesCompleted: result.exchangesCompleted,
            conversationStatus: result.conversationStatus,
        });
    } catch (err) {
        console.error("retry reply failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

/**
 * POST /tasks/submit
 * Submits conversation for review with automatic checks:
 * - Minimum exchanges (5)
 * - Conversation-wide uniqueness (0.85 threshold)
 * - Flagged ratio (max 0.3)
 * - Fake judge evaluation
 * Auto-rejects if any check fails, otherwise marks PENDING_REVIEW.
 */
router.post("/submit", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = taskSubmitSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result: SubmitConversationResult = await submitConversation({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            conversationId: parsed.data.conversationId,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "not_found") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "conversation_ended") {
            return res.status(result.httpStatus).json(result.body);
        }
        if (result.status === "below_min_exchanges") {
            return res.status(result.httpStatus).json(result.body);
        }

        // status === "ok"
        return res.status(200).json({
            status: "ok",
            conversation: result.conversation,
        });
    } catch (err) {
        console.error("submit conversation failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;