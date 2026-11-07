import { z } from "zod";
import { type TierName } from "./tiers";

// ---------------------------------------------------------------------------
// Task System (M5): shared rules only.
// All limits, thresholds and rules live here as constants. No numbers hardcoded
// elsewhere.
// ---------------------------------------------------------------------------

// --- Conversation limits ---

/** Minimum number of exchanges (user+AI pairs) before submit is allowed (12 per PRD). */
export const TASK_MIN_EXCHANGES = 12;

// --- Dev-only override for TASK_MIN_EXCHANGES ---
// Only works when NODE_ENV=development. Ignored in production.

let taskMinExchangesOverride: number | null = null;
if (process.env.NODE_ENV === "development" && process.env.TASK_MIN_EXCHANGES_OVERRIDE) {
  const parsed = parseInt(process.env.TASK_MIN_EXCHANGES_OVERRIDE, 10);
  if (!Number.isNaN(parsed) && parsed > 0) {
    taskMinExchangesOverride = parsed;
  }
}

/** Get the effective minimum exchanges (respects dev-only override). */
export function getTaskMinExchanges(): number {
  return taskMinExchangesOverride ?? TASK_MIN_EXCHANGES;
}

/** Minimum words per user message. Fewer rejects with reason code. */
export const TASK_MIN_WORDS_PER_MESSAGE = 3;

/** Maximum characters per user message. Longer rejects with reason code. */
export const TASK_MAX_MESSAGE_LENGTH = 2000;

/** Similarity threshold for near-duplicate detection (0-1). */
export const TASK_UNIQUENESS_THRESHOLD = 0.85;

/** Maximum messages per minute per user (rate limit). */
export const TASK_RATE_LIMIT_MPM = 10;

/** Inactivity timeout: minutes after last activity before conversation auto-expires. */
export const TASK_INACTIVITY_TIMEOUT_MINUTES = 30;

/** Start cap per day: max conversations a user can START per day (across all tiers). */
export const TASK_START_CAP_PER_DAY = 20;

// --- AI Adapter settings ---

/** AI reply timeout in milliseconds. */
export const TASK_AI_REPLY_TIMEOUT_MS = 30000;

/** Token cap per AI reply. */
export const TASK_AI_TOKEN_CAP_PER_REPLY = 500;

/** Total token cap per conversation. */
export const TASK_AI_TOKEN_CAP_TOTAL = 8000;

/** Per-user message rate limit (messages per minute). */
export const TASK_USER_MESSAGE_RATE_LIMIT = 10;

/** Maximum flagged message ratio (0-1). Exceeds this = auto-reject. */
export const TASK_FLAGGED_RATIO_THRESHOLD = 0.3;

// --- Difficulty access per tier (from PRD) ---
// Rookie gets EASY and MEDIUM, Elite adds HARD, Legendary adds EXPERT.

export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";

export interface DifficultyAccess {
  [tier: string]: Difficulty[];
}

export const TIER_DIFFICULTY_ACCESS: DifficultyAccess = {
  ROOKIE: ["EASY", "MEDIUM"],
  ELITE: ["EASY", "MEDIUM", "HARD"],
  LEGENDARY: ["EASY", "MEDIUM", "HARD", "EXPERT"],
};

/** Get allowed difficulties for a tier. */
export function allowedDifficultiesForTier(tier: TierName): Difficulty[] {
  return TIER_DIFFICULTY_ACCESS[tier] ?? [];
}

/** Check if a tier can access a difficulty. */
export function tierCanAccessDifficulty(tier: TierName, difficulty: Difficulty): boolean {
  return allowedDifficultiesForTier(tier).includes(difficulty);
}

// --- Fixed feedback reason codes (user-visible, no thresholds exposed) ---

export const TASK_REJECTION_REASON = {
  BELOW_MIN_EXCHANGES: "BELOW_MIN_EXCHANGES",
  BELOW_MIN_WORDS: "BELOW_MIN_WORDS",
  EXCEEDS_MAX_LENGTH: "EXCEEDS_MAX_LENGTH",
  DUPLICATE_MESSAGE: "DUPLICATE_MESSAGE",
  FLAGGED_RATIO_EXCEEDED: "FLAGGED_RATIO_EXCEEDED",
  UNIQUENESS_BELOW_THRESHOLD: "UNIQUENESS_BELOW_THRESHOLD",
} as const;

export type TaskRejectionReason = (typeof TASK_REJECTION_REASON)[keyof typeof TASK_REJECTION_REASON];

export const TASK_REJECTION_REASON_TEXT: Record<TaskRejectionReason, string> = {
  BELOW_MIN_EXCHANGES: "The conversation needs more exchanges before it can be submitted.",
  BELOW_MIN_WORDS: "Your message is too short. Please write at least 3 words.",
  EXCEEDS_MAX_LENGTH: "Your message is too long. Please keep it under 2000 characters.",
  DUPLICATE_MESSAGE: "This message is too similar to one you already sent.",
  FLAGGED_RATIO_EXCEEDED: "Too many messages were flagged for review.",
  UNIQUENESS_BELOW_THRESHOLD: "The conversation doesn't have enough unique messages.",
};

// --- Conversation status (mirrors Prisma enum) ---

export const CONVERSATION_STATUS = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_REJECTED: "AUTO_REJECTED",
  PENDING_REVIEW: "PENDING_REVIEW",
  EXPIRED: "EXPIRED",
  // Reserved for review feature:
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type ConversationStatus = (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

// --- Terminal vs non-terminal statuses ---
export const TERMINAL_CONVERSATION_STATUSES: ConversationStatus[] = [
  CONVERSATION_STATUS.AUTO_REJECTED,
  CONVERSATION_STATUS.PENDING_REVIEW,
  CONVERSATION_STATUS.EXPIRED,
  CONVERSATION_STATUS.APPROVED,
  CONVERSATION_STATUS.REJECTED,
];

export const NON_TERMINAL_CONVERSATION_STATUSES: ConversationStatus[] = [
  CONVERSATION_STATUS.IN_PROGRESS,
  CONVERSATION_STATUS.SUBMITTED,
];

// --- New onboarding actions for task system ---

export type TaskAction =
  | "view_tasks"
  | "start_conversation"
  | "send_message"
  | "submit_conversation"
  | "complete_tutorial";

// These will be added to ACTION_ALLOWED_STATUSES in onboarding.ts
// For now, define which onboarding statuses allow each task action.
// Only ACTIVATED users with ACTIVE account status can perform task actions.
export const TASK_ACTION_ALLOWED_STATUSES: Record<TaskAction, readonly string[]> = {
  view_tasks: ["ACTIVATED"],
  start_conversation: ["ACTIVATED"],
  send_message: ["ACTIVATED"],
  submit_conversation: ["ACTIVATED"],
  complete_tutorial: ["ACTIVATED"],
};

// --- AI Provider settings (env-driven, no values committed) ---

export const AI_PROVIDERS = ["fake", "nim"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

// --- Request schemas (zod) ---

/** POST /tasks/tutorial/complete - empty body, idempotent */
export const tutorialCompleteSchema = z.object({});

/** POST /tasks/start - empty body */
export const taskStartSchema = z.object({});

/** POST /tasks/message */
export const taskMessageSchema = z.object({
  conversationId: z.string().min(1),
  clientMessageId: z.string().min(1).max(64),
  content: z.string().min(1).max(TASK_MAX_MESSAGE_LENGTH),
  typingDurationMs: z.number().int().min(0).optional(),
  pasted: z.boolean().optional(),
});

/** POST /tasks/retry-reply */
export const taskRetryReplySchema = z.object({
  conversationId: z.string().min(1),
});

/** POST /tasks/submit */
export const taskSubmitSchema = z.object({
  conversationId: z.string().min(1),
});

/** GET /tasks/current */
export const taskCurrentSchema = z.object({
  conversationId: z.string().min(1),
});

/** GET /tasks/result */
export const taskResultSchema = z.object({
  conversationId: z.string().min(1),
});

/** GET /tasks/history - optional query params */
export const taskHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type TutorialCompleteInput = z.infer<typeof tutorialCompleteSchema>;
export type TaskStartInput = z.infer<typeof taskStartSchema>;
export type TaskMessageInput = z.infer<typeof taskMessageSchema>;
export type TaskRetryReplyInput = z.infer<typeof taskRetryReplySchema>;
export type TaskSubmitInput = z.infer<typeof taskSubmitSchema>;
export type TaskCurrentInput = z.infer<typeof taskCurrentSchema>;
export type TaskResultInput = z.infer<typeof taskResultSchema>;
export type TaskHistoryInput = z.infer<typeof taskHistorySchema>;