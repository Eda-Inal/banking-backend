import type { Channel, ConsumeMessage } from 'amqplib';

export function getConsumeMessageAttempts(msg: ConsumeMessage): number {
  const raw = msg.properties.headers?.['x-attempts'];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return 0;
}

export function republishForRetry(
  channel: Channel,
  msg: ConsumeMessage,
  attempts: number,
): boolean {
  const exchange = msg.fields.exchange;
  const routingKey = msg.fields.routingKey;
  if (!exchange || !routingKey) return false;

  const headers = { ...(msg.properties.headers ?? {}), 'x-attempts': attempts };
  return channel.publish(exchange, routingKey, msg.content, {
    ...msg.properties,
    headers,
    persistent: true,
    messageId: msg.properties.messageId,
    timestamp: Date.now(),
  });
}
