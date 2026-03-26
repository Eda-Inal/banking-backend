import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { getFraudRejectionMessage } from '../fraud/fraud-user-messages';
import { RequestContext } from '../common/request-context/request-context';
import { TransactionType } from '../common/enums';
import { CreateDepositRequestDto } from './dto/create-deposit-request';
import { CreateWithdrawRequestDto } from './dto/create-withdraw-request';
import { CreateTransferRequestDto } from './dto/create-transfer-request';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { transactionMapper } from './transactions.mapper';
import { TransactionAccountValidator } from './transaction-account-validator';
import { TransactionIdempotencyChecker } from './transaction-idempotency-checker';
import { TransactionRepository } from './transaction-repository';
import { TransactionEventWriter } from './transaction-event-writer';

type WithdrawTxResult =
  | { kind: 'SUCCESS'; dto: TransactionResponseDto }
  | { kind: 'REJECT'; fraudReason?: string };

type TransferTxResult =
  | { kind: 'SUCCESS'; dto: TransactionResponseDto }
  | { kind: 'REJECT'; fraudReason?: string };

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fraudService: FraudService,
    private readonly accountValidator: TransactionAccountValidator,
    private readonly idempotencyChecker: TransactionIdempotencyChecker,
    private readonly transactionRepository: TransactionRepository,
    private readonly transactionEventWriter: TransactionEventWriter,
  ) {}

  async createDeposit(
    userId: string,
    createDepositRequestDto: CreateDepositRequestDto,
  ): Promise<TransactionResponseDto> {
    const { amount, referenceId, toAccountId } = createDepositRequestDto;
    const { clientIpMasked, userAgent, traceId } = RequestContext.get();

    const existing = await this.idempotencyChecker.findExisting(
      userId,
      referenceId,
    );
    const idempotentResult = this.idempotencyChecker.resolveExistingOrThrow({
      existing,
      referenceId,
      userId,
      type: TransactionType.DEPOSIT,
    });
    if (idempotentResult) {
      return idempotentResult;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const account = await this.accountValidator.getAccountOrThrow(
          tx,
          toAccountId,
          'Deposit',
        );
        this.accountValidator.ensureOwnedByUserOrThrow(
          account.customerId,
          userId,
          'Deposit',
          toAccountId,
        );
        this.accountValidator.ensureActiveOrThrow(
          account.status,
          userId,
          'Deposit',
          toAccountId,
          'Account is not active',
        );

        const transaction =
          await this.transactionRepository.createPendingTransaction({
            tx,
            type: TransactionType.DEPOSIT,
            actorCustomerId: userId,
            fromAccountId: null,
            toAccountId,
            amount,
            referenceId,
          });

        await this.transactionRepository.incrementBalance(tx, toAccountId, amount);
        const completedTransaction = await this.transactionRepository.markCompleted(
          tx,
          transaction.id,
        );

        await this.transactionEventWriter.createCompletedEvent({
          tx,
          actorId: userId,
          resourceId: completedTransaction.id,
          traceId,
          transactionType: TransactionType.DEPOSIT,
          referenceId,
          amount,
          fromAccountId: null,
          toAccountId,
          clientIpMasked,
          userAgent,
        });

        return transactionMapper.toResponseDto(completedTransaction);
      });

      this.logger.log(
        `Deposit completed: transactionId=${result.id}, toAccountId=${toAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`,
      );
      return result;
    } catch (err) {
      const fallback = await this.idempotencyChecker.resolveP2002Fallback({
        err,
        userId,
        referenceId,
        type: TransactionType.DEPOSIT,
      });
      if (fallback) {
        return fallback;
      }
      throw err;
    }
  }

  async createWithdraw(
    userId: string,
    createWithdrawRequestDto: CreateWithdrawRequestDto,
  ): Promise<TransactionResponseDto> {
    const { amount, referenceId, fromAccountId } = createWithdrawRequestDto;
    const amountDecimal = new Prisma.Decimal(amount);
    const { clientIpMasked, userAgent, traceId } = RequestContext.get();

    const existing = await this.idempotencyChecker.findExisting(
      userId,
      referenceId,
    );
    const idempotentResult = this.idempotencyChecker.resolveExistingOrThrow({
      existing,
      referenceId,
      userId,
      type: TransactionType.WITHDRAW,
    });
    if (idempotentResult) {
      return idempotentResult;
    }

    try {
      const result = (await this.prisma.$transaction(async (tx) => {
        const account = await this.accountValidator.getAccountOrThrow(
          tx,
          fromAccountId,
          'Withdraw',
        );
        this.accountValidator.ensureOwnedByUserOrThrow(
          account.customerId,
          userId,
          'Withdraw',
          fromAccountId,
        );
        this.accountValidator.ensureActiveOrThrow(
          account.status,
          userId,
          'Withdraw',
          fromAccountId,
          'Account is not active',
        );
        this.accountValidator.ensureSufficientBalanceOrThrow(
          account.balance,
          amountDecimal,
          userId,
          'Withdraw',
          fromAccountId,
          amount,
          'Account balance not enough',
        );

        const fraudResult = await this.fraudService.evaluateWithdraw({
          scope: 'WITHDRAW',
          userId,
          referenceId,
          fromAccountId,
          amount: amountDecimal,
        });

        if (fraudResult.decision === 'REJECT') {
          const rejectedTransaction =
            await this.transactionRepository.createRejectedTransaction({
              tx,
              type: TransactionType.WITHDRAW,
              actorCustomerId: userId,
              fromAccountId,
              toAccountId: null,
              amount,
              referenceId,
              fraudDecision: fraudResult.decision,
              fraudReason: fraudResult.reason,
            });

          await this.transactionEventWriter.createFailedFraudEvent({
            tx,
            actorId: userId,
            resourceId: rejectedTransaction.id,
            traceId,
            transactionType: TransactionType.WITHDRAW,
            referenceId,
            amount,
            fromAccountId,
            toAccountId: null,
            fraudRule: fraudResult.reason,
            clientIpMasked,
            userAgent,
          });

          return { kind: 'REJECT', fraudReason: fraudResult.reason };
        }

        const transaction =
          await this.transactionRepository.createPendingTransaction({
            tx,
            type: TransactionType.WITHDRAW,
            actorCustomerId: userId,
            fromAccountId,
            toAccountId: null,
            amount,
            referenceId,
          });

        await this.transactionRepository.decrementBalance(
          tx,
          fromAccountId,
          amount,
        );
        const completedTransaction = await this.transactionRepository.markCompleted(
          tx,
          transaction.id,
        );

        await this.transactionEventWriter.createCompletedEvent({
          tx,
          actorId: userId,
          resourceId: completedTransaction.id,
          traceId,
          transactionType: TransactionType.WITHDRAW,
          referenceId,
          amount,
          fromAccountId,
          toAccountId: null,
          clientIpMasked,
          userAgent,
        });

        return {
          kind: 'SUCCESS',
          dto: transactionMapper.toResponseDto(completedTransaction),
        };
      })) as WithdrawTxResult;

      if (result.kind === 'REJECT') {
        throw new BadRequestException(
          getFraudRejectionMessage(TransactionType.WITHDRAW, result.fraudReason),
        );
      }

      this.logger.log(
        `Withdraw completed: transactionId=${result.dto.id}, fromAccountId=${fromAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`,
      );
      return result.dto;
    } catch (err) {
      const fallback = await this.idempotencyChecker.resolveP2002Fallback({
        err,
        userId,
        referenceId,
        type: TransactionType.WITHDRAW,
      });
      if (fallback) {
        return fallback;
      }
      throw err;
    }
  }

  async createTransfer(
    userId: string,
    createTransferRequestDto: CreateTransferRequestDto,
  ): Promise<TransactionResponseDto> {
    const { amount, referenceId, toAccountId, fromAccountId } =
      createTransferRequestDto;
    const amountDecimal = new Prisma.Decimal(amount);
    const { clientIpMasked, userAgent, traceId } = RequestContext.get();

    const existing = await this.idempotencyChecker.findExisting(
      userId,
      referenceId,
    );
    const idempotentResult = this.idempotencyChecker.resolveExistingOrThrow({
      existing,
      referenceId,
      userId,
      type: TransactionType.TRANSFER,
    });
    if (idempotentResult) {
      return idempotentResult;
    }

    try {
      const result = (await this.prisma.$transaction(async (tx) => {
        const fromAccount = await this.accountValidator.getAccountOrThrow(
          tx,
          fromAccountId,
          'Transfer',
        );
        await this.accountValidator.getAccountOrThrow(tx, toAccountId, 'Transfer');

        this.accountValidator.ensureOwnedByUserOrThrow(
          fromAccount.customerId,
          userId,
          'Transfer',
          fromAccountId,
        );
        this.accountValidator.ensureActiveOrThrow(
          fromAccount.status,
          userId,
          'Transfer',
          fromAccountId,
          'From account is not active',
        );
        this.accountValidator.ensureSufficientBalanceOrThrow(
          fromAccount.balance,
          amountDecimal,
          userId,
          'Transfer',
          fromAccountId,
          amount,
          'Insufficient balance',
        );

        const fraudResult = await this.fraudService.evaluateTransfer({
          userId,
          fromAccountId,
          toAccountId,
          amount: amountDecimal,
          referenceId,
          scope: 'TRANSFER',
        });

        if (fraudResult.decision === 'REJECT') {
          const rejectedTransaction =
            await this.transactionRepository.createRejectedTransaction({
              tx,
              type: TransactionType.TRANSFER,
              actorCustomerId: userId,
              fromAccountId,
              toAccountId,
              amount,
              referenceId,
              fraudDecision: fraudResult.decision,
              fraudReason: fraudResult.reason,
            });

          await this.transactionEventWriter.createFailedFraudEvent({
            tx,
            actorId: userId,
            resourceId: rejectedTransaction.id,
            traceId,
            transactionType: TransactionType.TRANSFER,
            referenceId,
            amount,
            fromAccountId,
            toAccountId,
            fraudRule: fraudResult.reason,
            clientIpMasked,
            userAgent,
          });

          return { kind: 'REJECT', fraudReason: fraudResult.reason };
        }

        const transaction =
          await this.transactionRepository.createPendingTransaction({
            tx,
            type: TransactionType.TRANSFER,
            actorCustomerId: userId,
            fromAccountId,
            toAccountId,
            amount,
            referenceId,
          });

        await this.transactionRepository.decrementBalance(
          tx,
          fromAccountId,
          amount,
        );
        await this.transactionRepository.incrementBalance(tx, toAccountId, amount);

        const completedTransaction = await this.transactionRepository.markCompleted(
          tx,
          transaction.id,
        );

        await this.transactionEventWriter.createCompletedEvent({
          tx,
          actorId: userId,
          resourceId: completedTransaction.id,
          traceId,
          transactionType: TransactionType.TRANSFER,
          referenceId,
          amount,
          fromAccountId,
          toAccountId,
          clientIpMasked,
          userAgent,
        });

        return {
          kind: 'SUCCESS',
          dto: transactionMapper.toResponseDto(completedTransaction),
        };
      })) as TransferTxResult;

      if (result.kind === 'REJECT') {
        throw new BadRequestException(
          getFraudRejectionMessage(TransactionType.TRANSFER, result.fraudReason),
        );
      }

      this.logger.log(
        `Transfer completed: txId=${result.dto.id}, from=${fromAccountId}, to=${toAccountId}, amount=${amount}`,
      );
      return result.dto;
    } catch (err) {
      const fallback = await this.idempotencyChecker.resolveP2002Fallback({
        err,
        userId,
        referenceId,
        type: TransactionType.TRANSFER,
      });
      if (fallback) {
        return fallback;
      }
      throw err;
    }
  }
}
