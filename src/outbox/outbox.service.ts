import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMqPublisher } from '../messaging/rabbitmq.publisher';
import { EventStatus } from '../common/enums';
import { BANKING_EVENT_SCHEMA_VERSION } from '../common/banking-event-schema.version';
import { CONFIG_KEYS } from '../config/config';
import { StructuredLogger } from '../logger/structured-logger.service';

type OutboxPublishMessage = {
  eventId: string;
  type: string;
  occurredAt: string;
  schemaVersion: typeof BANKING_EVENT_SCHEMA_VERSION;
  payload: unknown;
};

type ClaimedEventRow = {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  retry_count: number;
  next_retry_at: Date | null;
  last_error: string | null;
  published_at: Date | null;
  created_at: Date;
  claimed_at: Date | null;
};

type OutboxMetrics = {
  fetched: number;
  processed: number;
  failed: number;
  retried: number;
  lastRunAt: string | null;
};

@Injectable()
export class OutboxService {
  private readonly exchange: string;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly claimTtlMs: number;
  private readonly metrics: OutboxMetrics = {
    fetched: 0,
    processed: 0,
    failed: 0,
    retried: 0,
    lastRunAt: null,
  };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly publisher: RabbitMqPublisher,
    private readonly structuredLogger: StructuredLogger,
  ) {
    this.exchange =
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_EXCHANGE) ??
      'banking.events';

    this.batchSize = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.OUTBOX_BATCH_SIZE),
      20,
    );

    this.maxRetries = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.OUTBOX_MAX_RETRIES),
      5,
    );

    this.retryBaseDelayMs = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.OUTBOX_RETRY_BASE_DELAY_MS),
      1000,
    );

    this.claimTtlMs = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.OUTBOX_CLAIM_TTL_MS),
      300000,
    );
  }

  async processPendingEvents(): Promise<void> {
    const events = await this.claimNextBatch();
    if (!events.length) return;

    this.metrics.fetched += events.length;
    this.metrics.lastRunAt = new Date().toISOString();

    for (const row of events) {
      const evt = {
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: row.created_at,
        retryCount: row.retry_count,
        claimedAt: row.claimed_at,
      };

      let published = false;
      try {
        const routingKey = String(evt.type).toLowerCase();
        const message: OutboxPublishMessage = {
          eventId: evt.id,
          type: evt.type,
          occurredAt: evt.createdAt.toISOString(),
          schemaVersion: BANKING_EVENT_SCHEMA_VERSION,
          payload: evt.payload,
        };

        await this.publisher.publish(
          this.exchange,
          routingKey,
          message,
          {
            messageId: evt.id,
            timestamp: evt.createdAt,
            headers: {
              eventType: evt.type,
              source: 'banking-backend',
              schemaVersion: BANKING_EVENT_SCHEMA_VERSION,
            },
          },
        );
        published = true;

        const finalized = await this.prisma.event.updateMany({
          where: {
            id: evt.id,
            status: EventStatus.PUBLISHING,
            claimedAt: evt.claimedAt,
          },
          data: {
            status: EventStatus.PROCESSED,
            publishedAt: new Date(),
            lastError: null,
            nextRetryAt: null,
            claimedAt: null,
          },
        });

        if (finalized.count !== 1) {
          this.structuredLogger.warn(OutboxService.name, 'Outbox finalize PROCESSED skipped', {
            eventType: 'OUTBOX',
            action: 'FINALIZE_PROCESSED_SKIPPED',
            eventId: evt.id,
          });
        } else {
          this.metrics.processed += 1;
          this.structuredLogger.info(OutboxService.name, 'Outbox published event', {
            eventType: 'OUTBOX',
            action: 'PUBLISH_SUCCESS',
            eventId: evt.id,
            eventName: evt.type,
          });
        }
      } catch (error) {
        if (published) {
          // critical: message already published. Never downgrade to FAILED here, or we risk duplicate publish retries.
          this.structuredLogger.error(OutboxService.name, 'Outbox published but finalize failed', {
            details: {
              eventType: 'OUTBOX',
              action: 'PUBLISH_FINALIZE_ERROR',
              eventId: evt.id,
              claimedAt: evt.claimedAt?.toISOString() ?? null,
            },
            error: error instanceof Error ? error : { message: String(error) },
          });
          continue;
        }

        const currentRetry = evt.retryCount ?? 0;
        const nextRetryCount = currentRetry + 1;
        const shouldRetry = nextRetryCount <= this.maxRetries;
        this.metrics.failed += 1;
        if (shouldRetry) this.metrics.retried += 1;

        const nextRetryAt = shouldRetry
          ? new Date(Date.now() + this.getBackoffDelayMs(nextRetryCount))
          : null;

        const updated = await this.prisma.event.updateMany({
          where: {
            id: evt.id,
            status: EventStatus.PUBLISHING,
            claimedAt: evt.claimedAt,
          },
          data: {
            status: EventStatus.FAILED,
            retryCount: nextRetryCount,
            nextRetryAt,
            lastError: error instanceof Error ? error.message : String(error),
            claimedAt: null,
          },
        });

        if (updated.count !== 1) {
          this.structuredLogger.warn(OutboxService.name, 'Outbox finalize FAILED skipped', {
            eventType: 'OUTBOX',
            action: 'FINALIZE_FAILED_SKIPPED',
            eventId: evt.id,
          });
        } else {
          this.structuredLogger.warn(OutboxService.name, 'Outbox failed event', {
            eventType: 'OUTBOX',
            action: 'PUBLISH_FAILED',
            eventId: evt.id,
            eventName: evt.type,
            retryCount: nextRetryCount,
            maxRetries: this.maxRetries,
            nextRetryAt: nextRetryAt?.toISOString() ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  getMetrics(): OutboxMetrics {
    return { ...this.metrics };
  }

  private async claimNextBatch(): Promise<ClaimedEventRow[]> {
    return this.prisma.$queryRaw<ClaimedEventRow[]>`
      WITH candidates AS (
        SELECT id FROM events
        WHERE (
          status = 'PENDING'::"EventStatus"
          OR (
            status = 'FAILED'::"EventStatus"
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          )
          OR (
            status = 'PUBLISHING'::"EventStatus"
            AND claimed_at IS NOT NULL
            AND claimed_at < NOW() - (INTERVAL '1 millisecond' * ${this.claimTtlMs})
          )
        )
        ORDER BY created_at ASC
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE events AS e
      SET status = 'PUBLISHING'::"EventStatus", claimed_at = NOW()
      FROM candidates c
      WHERE e.id = c.id
      RETURNING
        e.id,
        e.type,
        e.payload,
        e.retry_count,
        e.next_retry_at,
        e.last_error,
        e.published_at,
        e.created_at,
        e.claimed_at
    `;
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  private getBackoffDelayMs(retryCount: number): number {
    return this.retryBaseDelayMs * 2 ** (retryCount - 1);
  }
}
