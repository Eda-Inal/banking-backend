-- AlterTable
ALTER TABLE "processed_messages" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "transactions_actor_customer_id_type_status_created_at_idx" ON "transactions"("actor_customer_id", "type", "status", "created_at");
