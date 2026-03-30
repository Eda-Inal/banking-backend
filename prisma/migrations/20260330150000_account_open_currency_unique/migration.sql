-- Ensure a customer can have only one non-closed account per currency.
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_customer_currency_open_unique"
ON "accounts" ("customer_id", "currency")
WHERE "status" <> 'CLOSED'::"AccountStatus";
