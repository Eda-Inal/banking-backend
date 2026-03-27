-- CreateEnum
CREATE TYPE "ProcessedMessageStatus" AS ENUM ('CLAIMED', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "processed_messages"
ADD COLUMN "status" "ProcessedMessageStatus" NOT NULL DEFAULT 'CLAIMED',
ADD COLUMN "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "last_error" TEXT,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows as completed dedup history
UPDATE "processed_messages"
SET
  "status" = 'COMPLETED',
  "claimed_at" = COALESCE("processed_at", CURRENT_TIMESTAMP),
  "completed_at" = COALESCE("processed_at", CURRENT_TIMESTAMP),
  "updated_at" = COALESCE("processed_at", CURRENT_TIMESTAMP);

-- CreateIndex
CREATE INDEX "processed_messages_consumer_status_idx"
ON "processed_messages"("consumer", "status");
