import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import { CONFIG_KEYS } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMqConnection } from './rabbitmq.connection';
import type { TransactionEventPayload } from '../common/transaction-event.contract';
import { TransactionType, EventType } from '../common/enums';

type ConsumedEventMessage = {
  eventId?: string;
  type?: string;
  occurredAt?: string;
  payload?: unknown;
};

class PermanentConsumerError extends Error {}
class TransientConsumerError extends Error {}

type ConsumerMetrics = {
  consumed: number;
  duplicates: number;
  nacked: number;
  requeued: number;
  lastMessageAt: string | null;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidTransactionType(v: unknown): v is TransactionType {
  return typeof v === 'string' && Object.values(TransactionType).includes(v as TransactionType);
}

function validateTransactionEventPayload(payload: unknown): TransactionEventPayload {
  if (!payload || typeof payload !== 'object') {
    throw new PermanentConsumerError('invalid transaction payload: not an object');
  }

  const p = payload as any;

  if (!isNonEmptyString(p.actorId)) {
    throw new PermanentConsumerError('invalid transaction payload: actorId');
  }
  if (!isNonEmptyString(p.resourceId)) {
    throw new PermanentConsumerError('invalid transaction payload: resourceId');
  }
  if (!isNonEmptyString(p.traceId)) {
    throw new PermanentConsumerError('invalid transaction payload: traceId');
  }
  if (p.outcome !== 'SUCCESS' && p.outcome !== 'FAILURE') {
    throw new PermanentConsumerError('invalid transaction payload: outcome');
  }

  if (p.reasonCode !== undefined && p.reasonCode !== null && !isNonEmptyString(p.reasonCode)) {
    throw new PermanentConsumerError('invalid transaction payload: reasonCode');
  }

  const m = p.metadata;
  if (!m || typeof m !== 'object') {
    throw new PermanentConsumerError('invalid transaction payload: metadata');
  }
  if (!isValidTransactionType(m.transactionType)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.transactionType');
  }
  if (!isNonEmptyString(m.referenceId)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.referenceId');
  }
  if (typeof m.amount !== 'number' || !Number.isFinite(m.amount)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.amount');
  }

  const fromOk =
    m.fromAccountId === null || m.fromAccountId === undefined || isNonEmptyString(m.fromAccountId);
  const toOk =
    m.toAccountId === null || m.toAccountId === undefined || isNonEmptyString(m.toAccountId);

  if (!fromOk || !toOk) {
    throw new PermanentConsumerError('invalid transaction payload: metadata account ids');
  }

  if (m.fraudRule !== undefined && m.fraudRule !== null && !isNonEmptyString(m.fraudRule)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.fraudRule');
  }

  return p as TransactionEventPayload;
}

@Injectable()
export class RabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConsumer.name);
  private readonly consumerName = 'banking-backend';
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
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqConnection,
  ) {}

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

    try {
      const parsed = this.parseMessage(msg.content);
      const messageId = msg.properties.messageId ?? parsed.eventId;
      const eventType = parsed.type ?? 'UNKNOWN';

      if (!messageId) {
        throw new PermanentConsumerError('messageId is missing');
      }

      const alreadyProcessed = await this.isAlreadyProcessed(messageId);
      if (alreadyProcessed) {
        this.metrics.duplicates += 1;
        channel.ack(msg);
        return;
      }

      await this.dispatchEvent(parsed);
      const marked = await this.markProcessed(messageId, eventType);
      if (!marked) {
        this.metrics.duplicates += 1;
        this.logger.warn(
          `Consumer duplicate-detected-after-dispatch messageId=${messageId}`,
        );
      }
      this.metrics.consumed += 1;
      this.metrics.lastMessageAt = new Date().toISOString();
      channel.ack(msg);
      this.logger.log(`Consumer ack eventType=${eventType} messageId=${messageId}`);
    } catch (error) {
      const messageId = msg.properties.messageId ?? 'unknown';
      const requeue = this.isTransientError(error);
      this.metrics.nacked += 1;
      if (requeue) this.metrics.requeued += 1;
      channel.nack(msg, false, requeue);
      this.logger.warn(
        `Consumer nack messageId=${messageId} requeue=${requeue} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
      this.logger.log(`RabbitMQ consumer started queue=${queue}`);
    } catch (error) {
      this.logger.warn(
        `RabbitMQ consumer bootstrap retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private parseMessage(content: Buffer): ConsumedEventMessage {
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

  private async markProcessed(
    messageId: string,
    eventType: string,
  ): Promise<boolean> {
    const id = randomUUID();
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "processed_messages" ("id", "message_id", "event_type", "consumer", "processed_at")
      VALUES (${id}::uuid, ${messageId}, ${eventType}, ${this.consumerName}, NOW())
      ON CONFLICT ("consumer", "message_id") DO NOTHING
    `;

    return Number(inserted) > 0;
  }

  private async isAlreadyProcessed(messageId: string): Promise<boolean> {
    const existing = await this.prisma.$queryRaw<Array<{ message_id: string }>>`
      SELECT "message_id"
      FROM "processed_messages"
      WHERE "consumer" = ${this.consumerName}
        AND "message_id" = ${messageId}
      LIMIT 1
    `;
    return existing.length > 0;
  }
  

  
  private async dispatchEvent(message: ConsumedEventMessage): Promise<void> {
    switch (message.type) {
      case EventType.TRANSACTION_COMPLETED: {
        const payload = validateTransactionEventPayload(message.payload);
        this.logger.log(
          `Handled TRANSACTION_COMPLETED tx=${payload.resourceId} actor=${payload.actorId} trace=${payload.traceId}`,
        );
        return;
      }

      case EventType.TRANSACTION_FAILED: {
        const payload = validateTransactionEventPayload(message.payload);
        this.logger.warn(
          `Handled TRANSACTION_FAILED tx=${payload.resourceId} actor=${payload.actorId} trace=${payload.traceId} reasonCode=${payload.reasonCode ?? 'n/a'}`,
        );
        return;
      }

      default:
        throw new PermanentConsumerError(`unsupported event type: ${message.type}`);
    }
  }

  private isTransientError(error: unknown): boolean {
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

  getMetrics(): ConsumerMetrics {
    return { ...this.metrics };
  }
}
