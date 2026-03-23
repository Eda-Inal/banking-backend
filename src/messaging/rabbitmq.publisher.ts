import { Injectable } from '@nestjs/common';
import { RabbitMqConnection } from './rabbitmq.connection';

type PublishOptions = {
  messageId?: string;
  timestamp?: Date;
  headers?: Record<string, unknown>;
};

@Injectable()
export class RabbitMqPublisher {
  constructor(private readonly rabbit: RabbitMqConnection) {}

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<boolean> {
    const channel = this.rabbit.getChannel();

    await channel.assertExchange(exchange, 'topic', { durable: true });

    const ok = channel.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: options?.messageId,
        timestamp: (options?.timestamp ?? new Date()).getTime(),
        headers: options?.headers ?? {},
      },
    );

    return ok;
  }
}