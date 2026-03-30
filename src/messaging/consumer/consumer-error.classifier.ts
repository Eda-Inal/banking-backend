import {
  PermanentConsumerError,
  TransientConsumerError,
} from './consumer.errors';

export function isTransientConsumerError(error: unknown): boolean {
  if (error instanceof TransientConsumerError) return true;
  if (error instanceof PermanentConsumerError) return false;
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('connection') ||
    msg.includes('temporar')
  );
}
