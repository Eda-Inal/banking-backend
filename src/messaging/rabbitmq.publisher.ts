import { Injectable } from '@nestjs/common';
import { RabbitMqConnection } from './rabbitmq.connection';
import { StructuredLogger } from '../logger/structured-logger.service';

type PublishOptions = {
  messageId?: string;
  timestamp?: Date;
  headers?: Record<string, unknown>;
};

@Injectable()
export class RabbitMqPublisher {
  constructor(
    private readonly rabbit: RabbitMqConnection,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    const channel = this.rabbit.getPublisherChannel();

    await channel.assertExchange(exchange, 'topic', { durable: true });
    this.structuredLogger.debug(RabbitMqPublisher.name, 'RabbitMQ publish requested', {
      eventType: 'MESSAGING',
      action: 'PUBLISH',
      exchange,
      routingKey,
      messageId: options?.messageId ?? null,
    });

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
            this.structuredLogger.error(RabbitMqPublisher.name, 'RabbitMQ publish failed', {
              details: {
                eventType: 'MESSAGING',
                action: 'PUBLISH',
                exchange,
                routingKey,
                messageId: options?.messageId ?? null,
              },
              error: err,
            });
            reject(err);
            return;
          }
          resolve();
        },
      );
    });
  }
}