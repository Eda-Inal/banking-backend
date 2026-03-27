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
import { AuditService } from '../audit/audit.service';
import { RabbitMqConnection } from './rabbitmq.connection';
import type { TransactionEventPayload } from '../common/transaction-event.contract';
import { Action, TransactionType, EventType } from '../common/enums';

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


  if (
    m.clientIpMasked !== undefined &&
    m.clientIpMasked !== null &&
    !isNonEmptyString(m.clientIpMasked)
  ) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.clientIpMasked');
  }
  if (
    m.userAgent !== undefined &&
    m.userAgent !== null &&
    !isNonEmptyString(m.userAgent)
  ) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.userAgent');
  }

  return p as TransactionEventPayload;
}

@Injectable()
export class RabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConsumer.name);
  private readonly consumerName = 'banking-backend';
  private readonly claimTtlMs: number;
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
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rabbit: RabbitMqConnection,
  ) {
    this.claimTtlMs = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_CLAIM_TTL_MS),
      300000,
    );
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
      const parsed = this.parseMessage(msg.content);
      const messageId = msg.properties.messageId ?? parsed.eventId;
      const eventType = parsed.type ?? 'UNKNOWN';

      if (!messageId) {
        throw new PermanentConsumerError('messageId is missing');
      }

      const claimed = await this.claimMessage(messageId, eventType);
      if (!claimed) {
        this.metrics.duplicates += 1;
        this.logger.warn(`Consumer duplicate-skipped messageId=${messageId}`);
        channel.ack(msg);
        return;
      }
      claimedMessageId = messageId;

      await this.dispatchEvent(parsed);
      await this.markCompleted(messageId);
      this.metrics.consumed += 1;
      this.metrics.lastMessageAt = new Date().toISOString();
      channel.ack(msg);
      this.logger.log(`Consumer ack eventType=${eventType} messageId=${messageId}`);
    } catch (error) {
      if (claimedMessageId) {
        await this.markFailed(
          claimedMessageId,
          error instanceof Error ? error.message : String(error),
        );
      }
      const messageId = msg.properties.messageId ?? 'unknown';
      const isTransient = this.isTransientError(error);
      const currentAttempts = this.getAttempts(msg);
      const nextAttempts = currentAttempts + 1;

      if (isTransient && nextAttempts <= this.maxRetries) {
        const republished = this.republishForRetry(channel, msg, nextAttempts);
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

  private async claimMessage(
    messageId: string,
    eventType: string,
  ): Promise<boolean> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<{ claimed: number }>>`
      WITH inserted AS (
        INSERT INTO "processed_messages" (
          "id",
          "message_id",
          "event_type",
          "consumer",
          "status",
          "claimed_at",
          "processed_at",
          "updated_at"
        )
        VALUES (
          ${id}::uuid,
          ${messageId},
          ${eventType},
          ${this.consumerName},
          'CLAIMED'::"ProcessedMessageStatus",
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT ("consumer", "message_id") DO NOTHING
        RETURNING 1
      ),
      reclaimed AS (
        UPDATE "processed_messages"
        SET
          "status" = 'CLAIMED'::"ProcessedMessageStatus",
          "event_type" = ${eventType},
          "claimed_at" = NOW(),
          "last_error" = NULL,
          "updated_at" = NOW()
        WHERE "consumer" = ${this.consumerName}
          AND "message_id" = ${messageId}
          AND (
            "status" = 'FAILED'::"ProcessedMessageStatus"
            OR (
              "status" = 'CLAIMED'::"ProcessedMessageStatus"
              AND "claimed_at" < NOW() - (${this.claimTtlMs} * INTERVAL '1 millisecond')
            )
          )
        RETURNING 1
      )
      SELECT COUNT(*)::int AS claimed FROM (
        SELECT 1 FROM inserted
        UNION ALL
        SELECT 1 FROM reclaimed
      ) AS claims
    `;

    return Number(rows[0]?.claimed ?? 0) > 0;
  }

  private async markCompleted(messageId: string): Promise<void> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "processed_messages"
      SET
        "status" = 'COMPLETED'::"ProcessedMessageStatus",
        "completed_at" = NOW(),
        "processed_at" = NOW(),
        "updated_at" = NOW()
      WHERE "consumer" = ${this.consumerName}
        AND "message_id" = ${messageId}
        AND "status" = 'CLAIMED'::"ProcessedMessageStatus"
    `;

    if (Number(updated) !== 1) {
      throw new TransientConsumerError(
        `failed to finalize processed message as COMPLETED messageId=${messageId}`,
      );
    }
  }

  private async markFailed(messageId: string, errorMessage: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "processed_messages"
        SET
          "status" = 'FAILED'::"ProcessedMessageStatus",
          "last_error" = ${errorMessage},
          "updated_at" = NOW()
        WHERE "consumer" = ${this.consumerName}
          AND "message_id" = ${messageId}
      `;
    } catch (error) {
      this.logger.error(
        `Consumer failed to mark FAILED messageId=${messageId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }


  
  private async dispatchEvent(message: ConsumedEventMessage): Promise<void> {
    switch (message.type) {
      case EventType.TRANSACTION_COMPLETED: {
        const payload = validateTransactionEventPayload(message.payload);

        const txType = payload.metadata.transactionType;
        const action =
          txType === TransactionType.DEPOSIT
            ? Action.DEPOSIT
            : txType === TransactionType.WITHDRAW
              ? Action.WITHDRAW
              : Action.TRANSFER;

        await this.audit.recordSuccess({
          action,
          customerId: payload.actorId,
          entityType: 'TRANSACTION',
          entityId: payload.resourceId,
          actorId: payload.actorId,
          resourceId: payload.resourceId,
          traceId: payload.traceId,
          ipAddress: payload.metadata.clientIpMasked ?? null,
          userAgent: payload.metadata.userAgent ?? null,
          metadata: payload.metadata as any,
        });

        this.logger.log(
          `Handled TRANSACTION_COMPLETED tx=${payload.resourceId} actor=${payload.actorId} trace=${payload.traceId}`,
        );
        return;
      }

      case EventType.TRANSACTION_FAILED: {
        const payload = validateTransactionEventPayload(message.payload);

        const txType = payload.metadata.transactionType;
        const action =
          txType === TransactionType.DEPOSIT
            ? Action.DEPOSIT
            : txType === TransactionType.WITHDRAW
              ? Action.WITHDRAW
              : Action.TRANSFER;

        await this.audit.recordFailure({
          action,
          customerId: payload.actorId,
          entityType: 'TRANSACTION',
          entityId: payload.resourceId,
          actorId: payload.actorId,
          resourceId: payload.resourceId,
          traceId: payload.traceId,
          reasonCode: payload.reasonCode,
          ipAddress: payload.metadata.clientIpMasked ?? null,
          userAgent: payload.metadata.userAgent ?? null,
          metadata: payload.metadata as any,
        });

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

  private getAttempts(msg: ConsumeMessage): number {
    const raw = msg.properties.headers?.['x-attempts'];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    return 0;
  }

  private republishForRetry(
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

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
