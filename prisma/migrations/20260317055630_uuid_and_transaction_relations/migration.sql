/*
  Warnings:

  - The primary key for the `accounts` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `audit_logs` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `refresh_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `transactions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[reference_id]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.

*/

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_replaced_by_id_fkey";

-- AlterTable: customers (id text -> uuid, veri korunur)
ALTER TABLE "customers" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;

-- AlterTable: refresh_tokens (replaced_by_id nullable: boş string -> NULL)
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
ALTER TABLE "refresh_tokens" ALTER COLUMN "customer_id" TYPE uuid USING "customer_id"::uuid;
ALTER TABLE "refresh_tokens" ALTER COLUMN "replaced_by_id" TYPE uuid USING (CASE WHEN "replaced_by_id" IS NULL OR TRIM("replaced_by_id") = '' THEN NULL ELSE "replaced_by_id"::uuid END);

-- AlterTable: accounts
ALTER TABLE "accounts" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
ALTER TABLE "accounts" ALTER COLUMN "customer_id" TYPE uuid USING "customer_id"::uuid;

-- AlterTable: audit_logs
ALTER TABLE "audit_logs" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
ALTER TABLE "audit_logs" ALTER COLUMN "customer_id" TYPE uuid USING "customer_id"::uuid;

-- AlterTable: transactions (from_account, to_account nullable: boş string -> NULL)
ALTER TABLE "transactions" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
ALTER TABLE "transactions" ALTER COLUMN "from_account" TYPE uuid USING (CASE WHEN "from_account" IS NULL OR TRIM("from_account") = '' THEN NULL ELSE "from_account"::uuid END);
ALTER TABLE "transactions" ALTER COLUMN "to_account" TYPE uuid USING (CASE WHEN "to_account" IS NULL OR TRIM("to_account") = '' THEN NULL ELSE "to_account"::uuid END);

-- CreateIndex (IF NOT EXISTS: indeks zaten varsa atla)
CREATE INDEX IF NOT EXISTS "accounts_customer_id_idx" ON "accounts"("customer_id");
CREATE INDEX IF NOT EXISTS "audit_logs_customer_id_idx" ON "audit_logs"("customer_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_customer_id_idx" ON "refresh_tokens"("customer_id");
CREATE UNIQUE INDEX "transactions_reference_id_key" ON "transactions"("reference_id");
CREATE INDEX IF NOT EXISTS "transactions_from_account_idx" ON "transactions"("from_account");
CREATE INDEX IF NOT EXISTS "transactions_to_account_idx" ON "transactions"("to_account");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_account_fkey" FOREIGN KEY ("from_account") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_fkey" FOREIGN KEY ("to_account") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
