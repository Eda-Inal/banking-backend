-- AlterTable
ALTER TABLE "events" ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "next_retry_at" TIMESTAMP(3),
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "events_status_created_at_idx" ON "events"("status", "created_at");

-- CreateIndex
CREATE INDEX "events_status_next_retry_at_idx" ON "events"("status", "next_retry_at");
