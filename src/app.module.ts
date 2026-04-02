import { Module, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';
import { GlobalRateLimitMiddleware } from './common/middleware/global-rate-limit.middleware';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { RabbitMqModule } from './messaging/rabbitmq.module';
import { OutboxModule } from './outbox/outbox.module';
import { AuditModule } from './audit/audit.module';
import { LoggerModule } from './logger/logger.module';
import { RequestContextUserInterceptor } from './common/interceptors/request-context-user.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    RabbitMqModule,
    OutboxModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextUserInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TraceIdMiddleware, GlobalRateLimitMiddleware)
      .exclude('/health', '/metrics')
      .forRoutes('*');
  }
}

