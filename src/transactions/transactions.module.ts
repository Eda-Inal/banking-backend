import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { AuthModule } from '../auth/auth.module';
import { FraudModule } from '../fraud/fraud.module';
import { TransactionAccountValidator } from './transaction-account-validator';
import { TransactionIdempotencyChecker } from './transaction-idempotency-checker';
import { TransactionRepository } from './transaction-repository';
import { TransactionEventWriter } from './transaction-event-writer';

@Module({
  imports: [AuthModule, FraudModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionAccountValidator,
    TransactionIdempotencyChecker,
    TransactionRepository,
    TransactionEventWriter,
  ],
})
export class TransactionsModule {}
