import { Module } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}