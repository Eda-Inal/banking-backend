-- Add actor scope for transaction idempotency in a safe, backfillable way.
-- 1) Add nullable column
-- 2) Backfill from account ownership
-- 3) Enforce NOT NULL + FK
-- 4) Replace global reference_id uniqueness with scoped uniqueness

ALTER TABLE "transactions"
ADD COLUMN "actor_customer_id" UUID;

UPDATE "transactions" t
SET "actor_customer_id" = COALESCE(
  (SELECT a1."customer_id" FROM "accounts" a1 WHERE a1."id" = t."from_account"),
  (SELECT a2."customer_id" FROM "accounts" a2 WHERE a2."id" = t."to_account")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "transactions"
    WHERE "actor_customer_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Backfill failed: some transactions have NULL actor_customer_id';
  END IF;
END $$;

ALTER TABLE "transactions"
ALTER COLUMN "actor_customer_id" SET NOT NULL;

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_actor_customer_id_fkey"
FOREIGN KEY ("actor_customer_id") REFERENCES "customers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "transactions_reference_id_key";

CREATE INDEX IF NOT EXISTS "transactions_actor_customer_id_idx"
ON "transactions"("actor_customer_id");

CREATE UNIQUE INDEX "transactions_actor_customer_id_reference_id_key"
ON "transactions"("actor_customer_id", "reference_id");
