-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lock_until" TIMESTAMP(3);
