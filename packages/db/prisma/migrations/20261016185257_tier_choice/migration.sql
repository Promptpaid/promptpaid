-- AlterTable
ALTER TABLE "User" ADD COLUMN     "selectedTier" "UserTier",
ALTER COLUMN "tier" DROP NOT NULL,
ALTER COLUMN "tier" DROP DEFAULT;

-- None of the existing users have paid, so no paid tier exists yet.
UPDATE "User" SET "tier" = NULL;
