import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from './config/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = Number(config.get(CONFIG_KEYS.PORT)) || 3000;
  await app.listen(port);
}
bootstrap();
