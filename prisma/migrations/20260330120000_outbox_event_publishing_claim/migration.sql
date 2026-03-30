-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PUBLISHING';

-- AlterTable
ALTER TABLE "events" ADD COLUMN "claimed_at" TIMESTAMP(3);
