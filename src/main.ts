import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from './config/config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { StructuredLogger } from './logger/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);
  const structuredLogger = app.get(StructuredLogger);

  const config = app.get(ConfigService);
  const port = Number(config.get(CONFIG_KEYS.PORT)) || 3000;

  app.useGlobalFilters(new GlobalExceptionFilter(structuredLogger));
  app.useGlobalInterceptors(new SuccessResponseInterceptor(structuredLogger));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  app.use(cookieParser());

  // Proxy (Nginx, load balancer, Cloudflare) 
  const expressApp = app.getHttpAdapter().getInstance?.();
  if (expressApp && typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  await app.listen(port);
}
bootstrap();
