-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('TIER_ACTIVATION', 'WITHDRAWAL_VERIFICATION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNDERPAID', 'OVERPAID', 'EXPIRED', 'REVERSED', 'FLAGGED', 'USED');

-- CreateEnum
CREATE TYPE "ActivationPinStatus" AS ENUM ('NEW', 'USED', 'INVALIDATED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PaymentEventOutcome" AS ENUM ('CONSUMED', 'DUPLICATE', 'REJECTED', 'UNMATCHED', 'FAILED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'TIER_ACTIVATION',
    "expectedAmountKobo" INTEGER NOT NULL,
    "paidAmountKobo" INTEGER,
    "provider" TEXT NOT NULL,
    "accountReference" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "providerTxRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "flaggedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationPin" (
    "id" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "ActivationPinStatus" NOT NULL DEFAULT 'NEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "issuedNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventReference" TEXT NOT NULL,
    "outcome" "PaymentEventOutcome" NOT NULL,
    "reason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_accountReference_key" ON "Payment"("accountReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTxRef_key" ON "Payment"("providerTxRef");

-- CreateIndex
CREATE INDEX "Payment_userId_status_idx" ON "Payment"("userId", "status");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationPin_pinHash_key" ON "ActivationPin"("pinHash");

-- CreateIndex
CREATE INDEX "ActivationPin_paymentId_idx" ON "ActivationPin"("paymentId");

-- CreateIndex
CREATE INDEX "ActivationPin_userId_idx" ON "ActivationPin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_telegramId_key" ON "TelegramLink"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkKey_keyHash_key" ON "LinkKey"("keyHash");

-- CreateIndex
CREATE INDEX "LinkKey_userId_idx" ON "LinkKey"("userId");

-- CreateIndex
CREATE INDEX "PaymentEvent_provider_eventReference_idx" ON "PaymentEvent"("provider", "eventReference");

-- CreateIndex
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationPin" ADD CONSTRAINT "ActivationPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationPin" ADD CONSTRAINT "ActivationPin_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkKey" ADD CONSTRAINT "LinkKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One non-terminal payment per user: non-terminal = PENDING, CONFIRMED,
-- UNDERPAID, OVERPAID, FLAGGED (FLAGGED releases only via manual ops action:
-- confirm, reverse or expire). Terminal statuses EXPIRED, REVERSED and USED
-- do not match, so a fresh payment is allowed after them. Prisma cannot
-- express a partial invariant like this in a model, so it lives here only;
-- the schema header comment references this index.
CREATE UNIQUE INDEX "Payment_one_open_per_user_key" ON "Payment"("userId")
WHERE "status" IN ('PENDING', 'CONFIRMED', 'UNDERPAID', 'OVERPAID', 'FLAGGED');
