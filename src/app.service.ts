import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventStatus } from './common/enums';
import { CONFIG_KEYS } from './config/config';
import { RabbitMqConnection } from './messaging/rabbitmq.connection';
import { RabbitMqConsumer } from './messaging/rabbitmq.consumer';
import { OutboxService } from './outbox/outbox.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rabbit: RabbitMqConnection,
    private readonly rabbitConsumer: RabbitMqConsumer,
    private readonly outbox: OutboxService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth() {
    const snapshot = await this.getOperationalSnapshot();
    const alerts = this.evaluateAlerts(snapshot);
    const ok =
      snapshot.runtime.dbOk &&
      snapshot.runtime.redisOk &&
      snapshot.runtime.rabbitOk;

    return {
      ok,
      services: {
        database: snapshot.runtime.dbOk ? 'up' : 'down',
        redis: snapshot.runtime.redisOk ? 'up' : 'down',
        rabbitmq: snapshot.runtime.rabbitOk ? 'up' : 'down',
      },
      alerts,
      metrics: {
        runtime: snapshot.runtime,
        backlog: snapshot.backlog,
        outbox: this.outbox.getMetrics(),
        consumer: this.rabbitConsumer.getMetrics(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getPrometheusMetrics(): Promise<string> {
    const snapshot = await this.getOperationalSnapshot();
    const alerts = this.evaluateAlerts(snapshot);

    const lines = [
      '# HELP app_health_ok Overall app health status (1=up, 0=down)',
      '# TYPE app_health_ok gauge',
      `app_health_ok ${snapshot.runtime.dbOk && snapshot.runtime.redisOk && snapshot.runtime.rabbitOk ? 1 : 0}`,
      '# HELP outbox_pending_events Number of pending outbox events in database',
      '# TYPE outbox_pending_events gauge',
      `outbox_pending_events ${snapshot.backlog.pending}`,
      '# HELP outbox_failed_events Number of failed outbox events in database',
      '# TYPE outbox_failed_events gauge',
      `outbox_failed_events ${snapshot.backlog.failed}`,
      '# HELP outbox_processed_runtime_total Processed outbox events since app start',
      '# TYPE outbox_processed_runtime_total counter',
      `outbox_processed_runtime_total ${snapshot.runtime.outbox.processed}`,
      '# HELP outbox_retry_runtime_total Retried outbox events since app start',
      '# TYPE outbox_retry_runtime_total counter',
      `outbox_retry_runtime_total ${snapshot.runtime.outbox.retried}`,
      '# HELP consumer_consumed_runtime_total Consumed messages since app start',
      '# TYPE consumer_consumed_runtime_total counter',
      `consumer_consumed_runtime_total ${snapshot.runtime.consumer.consumed}`,
      '# HELP consumer_duplicate_runtime_total Duplicate messages detected since app start',
      '# TYPE consumer_duplicate_runtime_total counter',
      `consumer_duplicate_runtime_total ${snapshot.runtime.consumer.duplicates}`,
      '# HELP consumer_nack_runtime_total Nacked messages since app start',
      '# TYPE consumer_nack_runtime_total counter',
      `consumer_nack_runtime_total ${snapshot.runtime.consumer.nacked}`,
      '# HELP consumer_requeue_runtime_total Requeued messages since app start',
      '# TYPE consumer_requeue_runtime_total counter',
      `consumer_requeue_runtime_total ${snapshot.runtime.consumer.requeued}`,
      '# HELP app_alert_active_count Number of currently active alert conditions',
      '# TYPE app_alert_active_count gauge',
      `app_alert_active_count ${alerts.length}`,
    ];

    return `${lines.join('\n')}\n`;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async getOperationalSnapshot() {
    const [dbOk, redisOk, pending, failed] = await Promise.all([
      this.checkDatabase(),
      this.redis.ping(),
      this.prisma.event.count({ where: { status: EventStatus.PENDING } }),
      this.prisma.event.count({ where: { status: EventStatus.FAILED } }),
    ]);

    return {
      runtime: {
        dbOk,
        redisOk,
        rabbitOk: this.rabbit.isReady(),
        outbox: this.outbox.getMetrics(),
        consumer: this.rabbitConsumer.getMetrics(),
      },
      backlog: {
        pending,
        failed,
      },
    };
  }

  private evaluateAlerts(snapshot: {
    backlog: { pending: number; failed: number };
    runtime: { consumer: { nacked: number } };
  }): string[] {
    const pendingThreshold = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.ALERT_OUTBOX_PENDING_THRESHOLD),
      100,
    );
    const failedThreshold = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.ALERT_OUTBOX_FAILED_THRESHOLD),
      20,
    );
    const nackThreshold = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.ALERT_CONSUMER_NACK_THRESHOLD),
      10,
    );

    const alerts: string[] = [];
    if (snapshot.backlog.pending >= pendingThreshold) {
      alerts.push(`outbox_pending_high(${snapshot.backlog.pending})`);
    }
    if (snapshot.backlog.failed >= failedThreshold) {
      alerts.push(`outbox_failed_high(${snapshot.backlog.failed})`);
    }
    if (snapshot.runtime.consumer.nacked >= nackThreshold) {
      alerts.push(`consumer_nack_high(${snapshot.runtime.consumer.nacked})`);
    }

    return alerts;
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
