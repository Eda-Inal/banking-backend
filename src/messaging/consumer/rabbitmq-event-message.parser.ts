import { PermanentConsumerError } from './consumer.errors';
import type { ConsumedEventMessage } from './consumed-event.types';

export function parseConsumedEventMessage(content: Buffer): ConsumedEventMessage {
  try {
    const raw = content.toString('utf8');
    const parsed = JSON.parse(raw) as ConsumedEventMessage;
    if (!parsed.type) {
      throw new PermanentConsumerError('event type is missing');
    }
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
