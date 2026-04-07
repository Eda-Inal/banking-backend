import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { SuccessResponseInterceptor } from '../../src/common/interceptors/success-response.interceptor';
import { StructuredLogger } from '../../src/logger/structured-logger.service';

function applyE2eEnvOverrides(): void {
  const redisTestUrl = process.env.REDIS_URL_TEST?.trim();
  const rabbitTestUrl = process.env.RABBITMQ_URL_TEST?.trim();

  if (redisTestUrl) {
    process.env.REDIS_URL = redisTestUrl;
  }
  if (rabbitTestUrl) {
    process.env.RABBITMQ_URL = rabbitTestUrl;
  }
}

export async function createE2eApplication(): Promise<INestApplication> {
  applyE2eEnvOverrides();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({
    bufferLogs: true,
  });
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);
  const structuredLogger = app.get(StructuredLogger);

  app.useGlobalFilters(new GlobalExceptionFilter(structuredLogger));
  app.useGlobalInterceptors(new SuccessResponseInterceptor(structuredLogger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.use(cookieParser());

  const expressApp = app.getHttpAdapter().getInstance?.();
  if (expressApp && typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  await app.init();
  return app;
}
