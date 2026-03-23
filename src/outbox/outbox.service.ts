import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMqPublisher } from '../messaging/rabbitmq.publisher';
import { EventStatus } from '../common/enums';
import { CONFIG_KEYS } from '../config/config';

type OutboxPublishMessage = {
  eventId: string;
  type: string;
  occurredAt: Date;
  payload: unknown;
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
  private readonly logger = new Logger(OutboxService.name);
  private readonly exchange: string;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
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
  }


  async processPendingEvents(): Promise<void> {
    const events = await this.prisma.event.findMany({
      where: {
        OR: [
          { status: EventStatus.PENDING },
          {
            status: EventStatus.FAILED,
            nextRetryAt: { lte: new Date() },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
    });

    if (!events.length) return;
    this.metrics.fetched += events.length;
    this.metrics.lastRunAt = new Date().toISOString();

    for (const evt of events) {
      try {
        const routingKey = String(evt.type).toLowerCase();
        const message: OutboxPublishMessage = {
          eventId: evt.id,
          type: evt.type,
          occurredAt: evt.createdAt,
          payload: evt.payload,
        };

        const ok = await this.publisher.publish(
          this.exchange,
          routingKey,
          message,
          {
            messageId: evt.id,
            timestamp: evt.createdAt,
            headers: {
              eventType: evt.type,
              source: 'banking-backend',
              schemaVersion: '1',
            },
          },
        );

        if (!ok) {
          throw new Error('Rabbit publish returned false');
        }

        await this.prisma.event.update({
          where: { id: evt.id },
          data: {
            status: EventStatus.PROCESSED,
            publishedAt: new Date(),
            lastError: null,
            nextRetryAt: null,
          },
        });
        this.metrics.processed += 1;

        this.logger.log(`Outbox published event ${evt.id} (${evt.type})`);
      } catch (error) {
        const currentRetry = evt.retryCount ?? 0;
        const nextRetryCount = currentRetry + 1;
        const shouldRetry = nextRetryCount <= this.maxRetries;
        this.metrics.failed += 1;
        if (shouldRetry) this.metrics.retried += 1;

        const nextRetryAt = shouldRetry
          ? new Date(Date.now() + this.getBackoffDelayMs(nextRetryCount))
          : null;

        await this.prisma.event.update({
          where: { id: evt.id },
          data: {
            status: EventStatus.FAILED,
            retryCount: nextRetryCount,
            nextRetryAt,
            lastError: error instanceof Error ? error.message : String(error),
          },
        });

        this.logger.warn(
          `Outbox failed event ${evt.id} (${evt.type}) retry=${nextRetryCount}/${this.maxRetries} nextRetryAt=${nextRetryAt?.toISOString() ?? 'none'} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  getMetrics(): OutboxMetrics {
    return { ...this.metrics };
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
