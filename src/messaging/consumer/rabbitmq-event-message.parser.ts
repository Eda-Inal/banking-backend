import { BANKING_EVENT_SCHEMA_VERSION } from '../../common/banking-event-schema.version';
import { PermanentConsumerError } from './consumer.errors';
import type { ConsumedEventMessage } from './consumed-event.types';

function assertSupportedSchemaVersion(value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PermanentConsumerError('schemaVersion is missing or empty');
  }
  if (value !== BANKING_EVENT_SCHEMA_VERSION) {
    throw new PermanentConsumerError(
      `unsupported schemaVersion: ${value} (supported: ${BANKING_EVENT_SCHEMA_VERSION})`,
    );
  }
}

export function parseConsumedEventMessage(content: Buffer): ConsumedEventMessage {
  try {
    const raw = content.toString('utf8');
    const parsed = JSON.parse(raw) as ConsumedEventMessage;
    if (!parsed.type) {
      throw new PermanentConsumerError('event type is missing');
    }
    assertSupportedSchemaVersion(parsed.schemaVersion);
    return parsed;
  } catch (error) {
    if (error instanceof PermanentConsumerError) {
      throw error;
    }
    throw new PermanentConsumerError(
      `invalid message JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
