-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "user_agent" TEXT;
