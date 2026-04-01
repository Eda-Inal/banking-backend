import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CONFIG_KEYS } from '../config/config';
import { StructuredLogger } from '../logger/structured-logger.service';

function maskDatabaseUrl(url: string): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {
    const connectionString =
      config.get<string>(CONFIG_KEYS.DATABASE_URL) ?? '';
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    const url = this.config.get<string>(CONFIG_KEYS.DATABASE_URL) ?? '';
    this.structuredLogger.info(PrismaService.name, 'Prisma database config initialized', {
      eventType: 'INFRA',
      action: 'PRISMA_DB_CONFIG',
      databaseUrl: maskDatabaseUrl(url),
    });
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
