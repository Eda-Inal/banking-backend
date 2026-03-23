-- DropIndex
DROP INDEX "processed_messages_message_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "processed_messages_consumer_message_id_key"
ON "processed_messages"("consumer", "message_id");
