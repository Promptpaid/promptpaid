-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_REJECTED', 'PENDING_REVIEW', 'EXPIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');

-- CreateEnum
CREATE TYPE "ScenarioCategory" AS ENUM ('TEXT_CONVERSATION', 'MULTI_LANGUAGE', 'CULTURAL_CONTEXT');

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('USER', 'AI');

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "aiRole" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "minimumTurns" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "category" "ScenarioCategory" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    -- Snapshot of scenario at conversation start (immutable)
    "scenarioTitle" TEXT NOT NULL,
    "scenarioLanguage" TEXT NOT NULL,
    "scenarioAiRole" TEXT NOT NULL,
    "scenarioUserRole" TEXT NOT NULL,
    "scenarioObjective" TEXT NOT NULL,
    "scenarioMinimumTurns" INTEGER NOT NULL,
    "scenarioDifficulty" "Difficulty" NOT NULL,
    "scenarioCategory" "ScenarioCategory" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "rejectionReasonCodes" TEXT[],
    "rulesResult" JSONB,
    "judgeResult" JSONB,
    -- Day key computed in user's timezone at start (YYYY-MM-DD)
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    -- Client-provided message ID for idempotency (user messages only)
    "clientMessageId" TEXT,
    "serverCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "msSincePrevious" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    -- Weak/untrusted client signals
    "typingDurationMs" INTEGER,
    "pasted" BOOLEAN,
    -- Missing reply marker for failed AI calls
    "missingReply" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_title_language_key" ON "Scenario"("title", "language");

-- CreateIndex
CREATE INDEX "Scenario_language_active_idx" ON "Scenario"("language", "active");

-- CreateIndex
CREATE INDEX "Scenario_difficulty_category_active_idx" ON "Scenario"("difficulty", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userId_scenarioId_key" ON "Conversation"("userId", "scenarioId");

-- CreateIndex
CREATE INDEX "Conversation_userId_status_idx" ON "Conversation"("userId", "status");

-- CreateIndex
CREATE INDEX "Conversation_userId_dayKey_idx" ON "Conversation"("userId", "dayKey");

-- CreateIndex
CREATE INDEX "Conversation_scenarioId_idx" ON "Conversation"("scenarioId");

-- CreateIndex
CREATE INDEX "Conversation_startedAt_idx" ON "Conversation"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_clientMessageId_key" ON "Message"("conversationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "Message_conversationId_sender_idx" ON "Message"("conversationId", "sender");

-- CreateIndex
CREATE INDEX "Message_serverCreatedAt_idx" ON "Message"("serverCreatedAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One active conversation per user (partial unique index).
-- Prisma cannot express a partial unique index in the model, so it lives
-- here as raw SQL. Only one conversation with status = 'IN_PROGRESS' per user.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Conversation_one_active_per_user" ON "Conversation"("userId")
WHERE "status" = 'IN_PROGRESS';

-- ---------------------------------------------------------------------------
-- Add tutorialCompletedAt to User (nullable timestamp)
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "tutorialCompletedAt" TIMESTAMP(3);