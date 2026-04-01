import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CONFIG_KEYS } from '../config/config';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async onModuleInit() {
    const url = this.config.get<string>(CONFIG_KEYS.REDIS_URL);
    if (!url) {
      throw new Error('REDIS_URL is required for RedisService');
    }
    this.client = new Redis(url);

    this.client.on('error', (err) => {
      this.structuredLogger.error(RedisService.name, 'Redis connection error', {
        details: {
          eventType: 'INFRA',
          action: 'REDIS_ERROR',
        },
        error: err instanceof Error ? err : { message: String(err) },
      });
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (err) {
        this.structuredLogger.warn(RedisService.name, 'Redis quit error', {
          eventType: 'INFRA',
          action: 'REDIS_QUIT_ERROR',
          failure: (err as Error)?.message ?? String(err),
        });
      }
      this.client = null;
    }
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    return this.client;
  }

  isReady(): boolean {
    return this.client?.status === 'ready';
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
