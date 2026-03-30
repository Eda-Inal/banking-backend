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
  ): Promise<void> {
    const channel = this.rabbit.getPublisherChannel();

    await channel.assertExchange(exchange, 'topic', { durable: true });

    await new Promise<void>((resolve, reject) => {
      channel.publish(
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
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        },
      );
    });
  }
}