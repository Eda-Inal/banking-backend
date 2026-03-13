/*
  Warnings:

  - You are about to drop the column `customerId` on the `accounts` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `entityType` on the `audit_logs` table. All the data in the column will be lost.
  - Added the required column `customer_id` to the `accounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customer_id` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entity_id` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entity_type` to the `audit_logs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TokenBlacklistType" AS ENUM ('ACCESS', 'REFRESH');

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_customerId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_customerId_fkey";

-- DropIndex
DROP INDEX "accounts_customerId_idx";

-- DropIndex
DROP INDEX "audit_logs_customerId_idx";

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "customerId",
ADD COLUMN     "customer_id" TEXT NOT NULL,
ALTER COLUMN "balance" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "customerId",
DROP COLUMN "entityId",
DROP COLUMN "entityType",
ADD COLUMN     "customer_id" TEXT NOT NULL,
ADD COLUMN     "entity_id" UUID NOT NULL,
ADD COLUMN     "entity_type" TEXT NOT NULL,
ALTER COLUMN "action" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "type" DROP DEFAULT;

-- DropEnum
DROP TYPE "Account_Status";

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "token_type" "TokenBlacklistType" NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "device_info" TEXT,
    "ip_address" TEXT,
    "reason" TEXT,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_blacklist_jti_key" ON "token_blacklist"("jti");

-- CreateIndex
CREATE INDEX "accounts_customer_id_idx" ON "accounts"("customer_id");

-- CreateIndex
CREATE INDEX "audit_logs_customer_id_idx" ON "audit_logs"("customer_id");

-- AddForeignKey
ALTER TABLE "token_blacklist" ADD CONSTRAINT "token_blacklist_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
