import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../config/config';
import { OutboxService } from './outbox.service';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly outboxService: OutboxService,
    private readonly structuredLogger: StructuredLogger,
  ) {
    this.pollIntervalMs = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.OUTBOX_POLL_INTERVAL_MS),
      2000,
    );
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    this.structuredLogger.info(OutboxWorker.name, 'Outbox worker started', {
      eventType: 'OUTBOX',
      action: 'WORKER_START',
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.structuredLogger.info(OutboxWorker.name, 'Outbox worker stopped', {
      eventType: 'OUTBOX',
      action: 'WORKER_STOP',
    });
  }

  private async tick(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.outboxService.processPendingEvents();
    } catch (error) {
      this.structuredLogger.error(OutboxWorker.name, 'Outbox tick error', {
        details: {
          eventType: 'OUTBOX',
          action: 'WORKER_TICK_ERROR',
        },
        error: error instanceof Error ? error : { message: String(error) },
      });
    } finally {
      this.isRunning = false;
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}