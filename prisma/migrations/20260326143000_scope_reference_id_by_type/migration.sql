-- Scope idempotency uniqueness by (actor_customer_id, type, reference_id)
-- so same reference_id can be reused across different transaction types.

DROP INDEX IF EXISTS "transactions_actor_customer_id_reference_id_key";

CREATE UNIQUE INDEX "transactions_actor_customer_id_type_reference_id_key"
ON "transactions"("actor_customer_id", "type", "reference_id");

