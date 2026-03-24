-- CreateEnum
CREATE TYPE "FraudDecision" AS ENUM ('APPROVE', 'REJECT');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "fraudDecision" "FraudDecision",
ADD COLUMN     "fraudReason" TEXT;
