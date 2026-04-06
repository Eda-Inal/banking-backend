import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { CONFIG_KEYS } from '../config/config';
import { buildWinstonModuleOptions } from './build-winston-options';
import { StructuredLogger } from './structured-logger.service';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>(CONFIG_KEYS.NODE_ENV) ?? 'development';
        return buildWinstonModuleOptions(nodeEnv === 'development');
      },
    }),
  ],
  providers: [StructuredLogger],
  exports: [WinstonModule, StructuredLogger],
})
export class LoggerModule {}
