import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { AuthModule } from '../auth/auth.module';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [AuthModule, FraudModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
