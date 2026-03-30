import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ConsumeMessage } from 'amqplib';
import { CONFIG_KEYS } from '../config/config';
import { RabbitMqConnection } from './rabbitmq.connection';
import { PermanentConsumerError } from './consumer/consumer.errors';
import { parseConsumedEventMessage } from './consumer/rabbitmq-event-message.parser';
import { isTransientConsumerError } from './consumer/consumer-error.classifier';
import {
  getConsumeMessageAttempts,
  republishForRetry,
} from './consumer/rabbitmq-retry.helper';
import { ProcessedMessageRepository } from './consumer/processed-message.repository';
import { RabbitMqTransactionEventDispatcher } from './consumer/rabbitmq-transaction-event.dispatcher';

type ConsumerMetrics = {
  consumed: number;
  duplicates: number;
  nacked: number;
  requeued: number;
  lastMessageAt: string | null;
};

@Injectable()
export class RabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConsumer.name);
  private readonly prefetchCount: number;
  private readonly maxRetries: number;
  private consumerTag: string | null = null;
  private bootstrapTimer: NodeJS.Timeout | null = null;
  private readonly metrics: ConsumerMetrics = {
    consumed: 0,
    duplicates: 0,
    nacked: 0,
    requeued: 0,
    lastMessageAt: null,
  };

  constructor(
    private readonly config: ConfigService,
    private readonly rabbit: RabbitMqConnection,
    private readonly processedMessages: ProcessedMessageRepository,
    private readonly transactionEventDispatcher: RabbitMqTransactionEventDispatcher,
  ) {
    this.prefetchCount = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_PREFETCH),
      10,
    );
    this.maxRetries = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_MAX_RETRIES),
      5,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.tryStartConsumer();
    if (this.consumerTag) return;

    this.bootstrapTimer = setInterval(() => {
      void this.tryStartConsumer();
    }, 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bootstrapTimer) {
      clearInterval(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }

    if (!this.consumerTag) return;

    try {
      const channel = this.rabbit.getChannel();
      await channel.cancel(this.consumerTag);
      this.logger.log('RabbitMQ consumer stopped');
    } finally {
      this.consumerTag = null;
    }
  }

  private async handleMessage(
    channel: Channel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (!msg) return;

    let claimedMessageId: string | null = null;
    try {
      const parsed = parseConsumedEventMessage(msg.content);
      const messageId = msg.properties.messageId ?? parsed.eventId;
      const eventType = parsed.type ?? 'UNKNOWN';

      if (!messageId) {
        throw new PermanentConsumerError('messageId is missing');
      }

      const claimed = await this.processedMessages.claim(messageId, eventType);
      if (!claimed) {
        this.metrics.duplicates += 1;
        this.logger.warn(`Consumer duplicate-skipped messageId=${messageId}`);
        channel.ack(msg);
        return;
      }
      claimedMessageId = messageId;

      await this.transactionEventDispatcher.dispatch(parsed);
      await this.processedMessages.markCompleted(messageId);
      this.metrics.consumed += 1;
      this.metrics.lastMessageAt = new Date().toISOString();
      channel.ack(msg);
      this.logger.log(`Consumer ack eventType=${eventType} messageId=${messageId}`);
    } catch (error) {
      if (claimedMessageId) {
        await this.processedMessages.markFailed(
          claimedMessageId,
          error instanceof Error ? error.message : String(error),
        );
      }
      const messageId = msg.properties.messageId ?? 'unknown';
      const isTransient = isTransientConsumerError(error);
      const currentAttempts = getConsumeMessageAttempts(msg);
      const nextAttempts = currentAttempts + 1;

      if (isTransient && nextAttempts <= this.maxRetries) {
        const republished = republishForRetry(channel, msg, nextAttempts);
        if (republished) {
          this.metrics.requeued += 1;
          channel.ack(msg);
          this.logger.warn(
            `Consumer retry scheduled messageId=${messageId} attempt=${nextAttempts}/${this.maxRetries} error=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return;
        }
      }

      const requeue = false;
      this.metrics.nacked += 1;
      this.logger.warn(
        `Consumer nack messageId=${messageId} requeue=${requeue} attempts=${nextAttempts}/${this.maxRetries} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      channel.nack(msg, false, requeue);
    }
  }

  private async tryStartConsumer(): Promise<void> {
    if (this.consumerTag) return;
    if (!this.rabbit.isReady()) return;

    try {
      const channel = this.rabbit.getChannel();
      const queue =
        this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_QUEUE) ??
        'banking.events.q';
      await channel.prefetch(this.prefetchCount);

      const consumeOk = await channel.consume(
        queue,
        (msg) => {
          void this.handleMessage(channel, msg);
        },
        { noAck: false },
      );

      this.consumerTag = consumeOk.consumerTag;
      if (this.bootstrapTimer) {
        clearInterval(this.bootstrapTimer);
        this.bootstrapTimer = null;
      }
      this.logger.log(
        `RabbitMQ consumer started queue=${queue} prefetch=${this.prefetchCount}`,
      );
    } catch (error) {
      this.logger.warn(
        `RabbitMQ consumer bootstrap retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  getMetrics(): ConsumerMetrics {
    return { ...this.metrics };
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
