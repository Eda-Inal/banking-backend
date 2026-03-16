import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from './config/config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { ValidationPipe, type LogLevel } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = Number(config.get(CONFIG_KEYS.PORT)) || 3000;

  const nodeEnv = config.get(CONFIG_KEYS.NODE_ENV) ?? process.env.NODE_ENV ?? 'development';
  const isDev = nodeEnv === 'development';
  const loggerLevels: LogLevel[] = isDev
    ? ['log', 'error', 'warn', 'debug']
    : ['log', 'error', 'warn'];
  app.useLogger(loggerLevels);

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new SuccessResponseInterceptor());
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
