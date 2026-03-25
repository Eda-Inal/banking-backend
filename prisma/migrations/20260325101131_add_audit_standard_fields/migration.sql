-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_id" UUID,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "outcome" "AuditOutcome",
ADD COLUMN     "reason_code" TEXT,
ADD COLUMN     "resource_id" UUID,
ADD COLUMN     "trace_id" TEXT;
