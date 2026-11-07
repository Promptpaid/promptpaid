import { type Difficulty } from "@promptpaid/shared";
import { TASK_AI_REPLY_TIMEOUT_MS, TASK_AI_TOKEN_CAP_PER_REPLY } from "@promptpaid/shared";

/** Shape of an AI reply returned by the adapter. */
export interface AIReply {
  content: string;
  tokensUsed: number;
}

/** Input for generating an AI reply. */
export interface AIReplyInput {
  scenarioSnapshot: {
    title: string;
    language: string;
    aiRole: string;
    userRole: string;
    objective: string;
    minimumTurns: number;
    difficulty: Difficulty;
    category: string;
  };
  conversationHistory: Array<{
    sender: "USER" | "AI";
    content: string;
  }>;
  userMessage: string;
  totalTokensUsedSoFar: number;
}

/** Result of the AI adapter call. */
export type AIAdapterResult =
  | { status: "ok"; reply: AIReply }
  | { status: "timeout" }
  | { status: "token_limit_exceeded"; message: string }
  | { status: "error"; message: string };

/**
 * Generate a fake AI reply for development.
 * This simulates the NVIDIA NIM API response structure.
 */
export async function fakeAIReply(input: AIReplyInput): Promise<AIAdapterResult> {
  const { scenarioSnapshot, conversationHistory, userMessage, totalTokensUsedSoFar } = input;

  // Check total token cap
  if (totalTokensUsedSoFar >= TASK_AI_TOKEN_CAP_PER_REPLY) {
    return {
      status: "token_limit_exceeded",
      message: "Conversation token limit reached.",
    };
  }

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

  // Generate a contextual reply based on the scenario
  const replies = generateContextualReply(scenarioSnapshot, conversationHistory, userMessage);

  // Estimate tokens (rough: ~4 chars per token)
  const tokensUsed = Math.ceil(replies.length / 4);

  return {
    status: "ok",
    reply: {
      content: replies,
      tokensUsed,
    },
  };
}

/**
 * Generate an AI reply via NVIDIA NIM.
 * TODO: Implement when NIM endpoint is available.
 * This is a slot for production - requires NIM_API_URL and NIM_API_KEY env vars.
 */
export async function nimAIReply(_input: AIReplyInput): Promise<AIAdapterResult> {
  // NIM endpoint not configured - return error for now
  // In production, this would call the NIM API with the scenario context
  return {
    status: "error",
    message: "NIM adapter not configured. Set AI_PROVIDER=nim and provide NIM_API_URL/NIM_API_KEY.",
  };
}

/**
 * Get the AI adapter based on environment configuration.
 * Returns the appropriate adapter function.
 */
export function getAIAdapter(): (input: AIReplyInput) => Promise<AIAdapterResult> {
  const provider = process.env.AI_PROVIDER ?? "fake";

  if (provider === "nim") {
    return nimAIReply;
  }

  return fakeAIReply;
}

/**
 * Call the AI adapter with timeout protection.
 */
export async function callAIWithTimeout(input: AIReplyInput): Promise<AIAdapterResult> {
  const adapter = getAIAdapter();

  // Race between adapter and timeout
  const timeoutPromise = new Promise<AIAdapterResult>((resolve) => {
    setTimeout(() => {
      resolve({ status: "timeout" });
    }, TASK_AI_REPLY_TIMEOUT_MS);
  });

  return Promise.race([adapter(input), timeoutPromise]);
}

/**
 * Generate a contextual fake reply based on scenario and conversation history.
 */
function generateContextualReply(
  scenario: AIReplyInput["scenarioSnapshot"],
  history: AIReplyInput["conversationHistory"],
  userMessage: string,
): string {
  const { aiRole, userRole, objective, difficulty, category } = scenario;

  // Build context for reply generation
  const exchangeCount = Math.floor(history.filter((m) => m.sender === "USER").length);

  // Generate varied responses based on scenario category and difficulty
  const templates: Record<string, string[]> = {
    TEXT_CONVERSATION: [
      `As your ${aiRole}, I understand. "${userMessage}" - let me respond as ${userRole}.`,
      `Interesting perspective. In this ${category.toLowerCase()} scenario, I would say...`,
      `Continuing our conversation: ${userMessage} - here is my response.`,
    ],
    MULTI_LANGUAGE: [
      `I notice you're practicing ${scenario.language}. "${userMessage}" - let me reply in character.`,
      `Good effort with the language. As ${aiRole}, I respond: ...`,
      `Language exchange: ${userMessage}. My response as ${userRole}: ...`,
    ],
    CULTURAL_CONTEXT: [
      `Cultural context: ${objective}. You said "${userMessage}". My take: ...`,
      `In this cultural scenario (${difficulty}), "${userMessage}" leads to...`,
      `Understanding the cultural nuance: ${userMessage}. Response: ...`,
    ],
  };

  const categoryTemplates = (templates as Record<string, string[]>)[category] ?? templates.TEXT_CONVERSATION;
  // categoryTemplates is guaranteed to exist because we fall back to TEXT_CONVERSATION
  // Use non-null assertion since we have a fallback
  const template = categoryTemplates![exchangeCount % categoryTemplates!.length];

  // Add some variation based on difficulty
  const difficultyPrefix = {
    EASY: "Simple response: ",
    MEDIUM: "Thoughtful response: ",
    HARD: "Nuanced response: ",
    EXPERT: "Expert-level response: ",
  }[difficulty] ?? "";

  return `${difficultyPrefix}${template}`;
}