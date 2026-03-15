import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CONFIG_KEYS } from '../config/config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>(CONFIG_KEYS.REDIS_URL);
    if (!url) {
      throw new Error('REDIS_URL is required for RedisService');
    }
    this.client = new Redis(url);

    this.client.on('error', (err) => {
      this.logger.warn('Redis connection error', err?.message ?? err);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (err) {
        this.logger.warn('Redis quit error', (err as Error)?.message ?? err);
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
}
