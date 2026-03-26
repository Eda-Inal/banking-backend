 import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepositRequestDto } from './dto/create-deposit-request';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { transactionMapper } from './transactions.mapper';
import { TransactionType, TransactionStatus, AccountStatus, EventType, EventStatus } from '../common/enums';
import { Prisma } from '../generated/prisma/client';
import { CreateWithdrawRequestDto } from './dto/create-withdraw-request';
import { CreateTransferRequestDto } from './dto/create-transfer-request';
import { RequestContext } from '../common/request-context/request-context';
import { FraudService } from '../fraud/fraud.service';
import type { TransactionEventMetadata, TransactionEventPayload } from '../common/transaction-event.contract';
import { getFraudRejectionMessage } from '../fraud/fraud-user-messages';

@Injectable()
export class TransactionsService {
    private readonly logger = new Logger(TransactionsService.name);

    constructor(private readonly prisma: PrismaService, private readonly fraudService: FraudService) { }

    private buildTransactionEventPayload(params: {
        actorId: string;
        resourceId: string;
        traceId: string;
        outcome: 'SUCCESS' | 'FAILURE';
        reasonCode?: string;
        metadata: TransactionEventMetadata;
      }): TransactionEventPayload {
        return {
          actorId: params.actorId,
          resourceId: params.resourceId,
          traceId: params.traceId,
          outcome: params.outcome,
          reasonCode: params.reasonCode,
          metadata: params.metadata,
        };
      }

    async createDeposit(userId: string, createDepositRequestDto: CreateDepositRequestDto): Promise<TransactionResponseDto> {
        const { amount, referenceId, toAccountId } = createDepositRequestDto;
        const { clientIpMasked, userAgent, traceId } = RequestContext.get();

        const existing = await this.prisma.transaction.findFirst({
            where: { actorCustomerId: userId, referenceId },
        });
        if (existing && existing.status === TransactionStatus.COMPLETED) {
            this.logger.log(`Deposit idempotent: referenceId ${referenceId}, transactionId ${existing.id}, user ${userId}`);
            return transactionMapper.toResponseDto(existing);
        }

        try {
            const result = await this.prisma.$transaction(async (tx) => {

                const account = await tx.account.findUnique({
                    where: { id: toAccountId }
                });
                if (!account) {
                    this.logger.warn(`Deposit: account not found toAccountId=${toAccountId}, user=${userId}`);
                    throw new NotFoundException('Account not found');
                }
                if (account.customerId !== userId) {
                    this.logger.warn(`Deposit: forbidden, toAccountId=${toAccountId} not owned by user=${userId}`);
                    throw new ForbiddenException('Account not found');
                }
                if (account.status !== AccountStatus.ACTIVE) {
                    this.logger.warn(`Deposit: account not active toAccountId=${toAccountId}, status=${account.status}, user=${userId}`);
                    throw new BadRequestException('Account is not active');
                }


                const transaction = await tx.transaction.create({
                    data: {
                        type: TransactionType.DEPOSIT,
                        actorCustomerId: userId,
                        fromAccountId: null,
                        toAccountId,
                        amount,
                        referenceId,
                        status: TransactionStatus.PENDING,
                    },
                });

                await tx.account.update({
                    where: { id: toAccountId },
                    data: {
                        balance: { increment: amount },
                    },
                });

                const completedTransaction = await tx.transaction.update({
                    where: { id: transaction.id },
                    data: {
                        status: TransactionStatus.COMPLETED,
                    },
                });

                await tx.event.create({
                    data: {
                      type: EventType.TRANSACTION_COMPLETED,
                      payload: this.buildTransactionEventPayload({
                        actorId: userId,
                        resourceId: completedTransaction.id,
                        traceId: traceId ?? 'missing-trace-id',
                        outcome: 'SUCCESS',
                        metadata: {
                          transactionType: TransactionType.DEPOSIT,
                          referenceId,
                          amount,
                          fromAccountId: null,
                          toAccountId,
                          clientIpMasked,
                          userAgent,
                        },
                      }),
                      status: EventStatus.PENDING,
                    },
                  });

                return transactionMapper.toResponseDto(completedTransaction);
            });
            this.logger.log(`Deposit completed: transactionId=${result.id}, toAccountId=${toAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`);
            return result;
        } catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findFirst({
                    where: { actorCustomerId: userId, referenceId },
                });
                if (byRef) {
                    this.logger.log(`Deposit P2002 idempotent: referenceId=${referenceId}, returned existing transactionId=${byRef.id}, user=${userId}`);
                    return transactionMapper.toResponseDto(byRef);
                }
            }
            throw err;
        }
    }

    async createWithdraw(userId: string, createWithdrawRequestDto: CreateWithdrawRequestDto): Promise<TransactionResponseDto> {
        const { amount, referenceId, fromAccountId } = createWithdrawRequestDto;
        const amountDecimal = new Prisma.Decimal(amount);
        const { clientIpMasked, userAgent, traceId } = RequestContext.get();

        const existing = await this.prisma.transaction.findFirst({
            where: { actorCustomerId: userId, referenceId },
          });
          
          if (existing) {
            if (existing.status === TransactionStatus.COMPLETED) {
              this.logger.log(
                `Withdraw idempotent: referenceId ${referenceId}, transactionId ${existing.id}, user ${userId}`,
              );
              return transactionMapper.toResponseDto(existing);
            }
          
            if (
              existing.status === TransactionStatus.REJECTED &&
              existing.fraudDecision === 'REJECT'
            ) {
              this.logger.warn(
                `Withdraw idempotent rejected: referenceId=${referenceId}, transactionId=${existing.id}, user=${userId}`,
              );
              throw new BadRequestException(
                getFraudRejectionMessage(TransactionType.WITHDRAW, existing.fraudReason ?? undefined),
              );
            }
          }
        type WithdrawTxResult =
          | { kind: 'SUCCESS'; dto: TransactionResponseDto }
          | { kind: 'REJECT'; rejectedTransactionId: string; fraudReason?: string };

        try {

            const result = (await this.prisma.$transaction(async (tx) => {
                const account = await tx.account.findUnique({
                    where: { id: fromAccountId }
                });
                if (!account) {
                    this.logger.warn(`Withdraw: account not found fromAccountId=${fromAccountId}, user=${userId}`);
                    throw new NotFoundException('Account not found');
                }
                if (account.customerId !== userId) {
                    this.logger.warn(`Withdraw: forbidden, fromAccountId=${fromAccountId} not owned by user=${userId}`);
                    throw new ForbiddenException('Account not found');
                }
                if (account.status !== AccountStatus.ACTIVE) {
                    this.logger.warn(`Withdraw: account not active fromAccountId=${fromAccountId}, status=${account.status}, user=${userId}`);
                    throw new BadRequestException('Account is not active');
                }

                if (account.balance.lt(amountDecimal)) {
                    this.logger.warn(`Withdraw: account balance not enough fromAccountId=${fromAccountId}, balance=${account.balance}, amount=${amount}, user=${userId}`);
                    throw new BadRequestException('Account balance not enough');
                }

                const fraudResult = await this.fraudService.evaluateWithdraw({
                    scope: 'WITHDRAW',
                    userId,
                    referenceId,
                    fromAccountId,
                    amount: amountDecimal,
                  });
                  
                  if (fraudResult.decision === 'REJECT') {
                    const rejectedTransaction = await tx.transaction.create({
                      data: {
                        type: TransactionType.WITHDRAW,
                        actorCustomerId: userId,
                        fromAccountId,
                        toAccountId: null,
                        amount,
                        referenceId,
                        status: TransactionStatus.REJECTED,
                        fraudDecision: fraudResult.decision,
                        fraudReason: fraudResult.reason,
                      },
                    });

                    await tx.event.create({
                      data: {
                        type: EventType.TRANSACTION_FAILED,
                        payload: this.buildTransactionEventPayload({
                          actorId: userId,
                          resourceId: rejectedTransaction.id,
                          traceId: traceId ?? 'missing-trace-id',
                          outcome: 'FAILURE',
                          reasonCode: 'FRAUD_REJECTED',
                          metadata: {
                            transactionType: TransactionType.WITHDRAW,
                            referenceId,
                            amount,
                            fromAccountId,
                            toAccountId: null,
                            fraudRule: fraudResult.reason,
                            clientIpMasked,
                            userAgent,
                          },
                        }),
                        status: EventStatus.PENDING,
                      },
                    });

                    return {
                      kind: 'REJECT',
                      rejectedTransactionId: rejectedTransaction.id,
                      fraudReason: fraudResult.reason,
                    };
                  }

                const transaction = await tx.transaction.create({
                    data: {
                        type: TransactionType.WITHDRAW,
                        actorCustomerId: userId,
                        fromAccountId,
                        toAccountId: null,
                        amount,
                        referenceId,
                        status: TransactionStatus.PENDING,
                    },
                });

                await tx.account.update({
                    where: { id: fromAccountId },
                    data: {
                        balance: { decrement: amount },
                    },
                });

                const completedTransaction = await tx.transaction.update({
                    where: { id: transaction.id },
                    data: {
                        status: TransactionStatus.COMPLETED,
                    },
                });

                await tx.event.create({
                    data: {
                      type: EventType.TRANSACTION_COMPLETED,
                      payload: this.buildTransactionEventPayload({
                        actorId: userId,
                        resourceId: completedTransaction.id,
                        traceId: traceId ?? 'missing-trace-id',
                        outcome: 'SUCCESS',
                        metadata: {
                          transactionType: TransactionType.WITHDRAW,
                          referenceId,
                          amount,
                          fromAccountId,
                          toAccountId: null,
                          clientIpMasked,
                          userAgent,
                        },
                      }),
                      status: EventStatus.PENDING,
                    },
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
            this.logger.log(`Withdraw completed: transactionId=${result.dto.id}, fromAccountId=${fromAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`);
            return result.dto;


        } catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findFirst({
                    where: { actorCustomerId: userId, referenceId },
                });
                if (byRef) {
                    this.logger.log(`Withdraw P2002 idempotent: referenceId=${referenceId}, returned existing transactionId=${byRef.id}, user=${userId}`);
                    return transactionMapper.toResponseDto(byRef);
                }
            }
            throw err;
        }
    }

    async createTransfer(userId: string, createTransferRequestDto: CreateTransferRequestDto): Promise<TransactionResponseDto> {

        const { amount, referenceId, toAccountId, fromAccountId } = createTransferRequestDto;
        const amountDecimal = new Prisma.Decimal(amount);
        const { clientIpMasked, userAgent, traceId } = RequestContext.get();


        const existing = await this.prisma.transaction.findFirst({
            where: { actorCustomerId: userId, referenceId },
        });
        if (existing) {
            if (existing.status === TransactionStatus.COMPLETED) {
                this.logger.log(`Transfer idempotent: referenceId ${referenceId}, transactionId ${existing.id}, user ${userId}`);
                return transactionMapper.toResponseDto(existing);
            }
            if (existing.status === TransactionStatus.REJECTED && existing.fraudDecision === 'REJECT') {
                this.logger.warn(`Transfer idempotent rejected: referenceId=${referenceId}, transactionId=${existing.id}, user=${userId}`);
                throw new BadRequestException(
                  getFraudRejectionMessage(TransactionType.TRANSFER, existing.fraudReason ?? undefined),
                );
            }
        }
        type TransferTxResult =
          | { kind: 'SUCCESS'; dto: TransactionResponseDto }
          | { kind: 'REJECT'; rejectedTransactionId: string; fraudReason?: string };

        try {

            const result = (await this.prisma.$transaction(async (tx) => {

                const [fromAccount, toAccount] = await Promise.all([
                    tx.account.findUnique({ where: { id: fromAccountId } }),
                    tx.account.findUnique({ where: { id: toAccountId } }),
                ]);
                if (!fromAccount) {
                    this.logger.warn(`Transfer: account not found fromAccountId=${fromAccountId}, user=${userId}`);
                    throw new NotFoundException('Account not found');
                }
                if (!toAccount) {
                    this.logger.warn(`Transfer: account not found toAccountId=${toAccountId}, user=${userId}`);
                    throw new NotFoundException('Account not found');
                }

                if (fromAccount.customerId !== userId) {
                    this.logger.warn(`Transfer: forbidden, fromAccountId=${fromAccountId} not owned by user=${userId}`);
                    throw new ForbiddenException('Account not found');
                }

                if (fromAccount.status !== AccountStatus.ACTIVE) {
                    this.logger.warn(`Transfer: from account not active fromAccountId=${fromAccountId}, status=${fromAccount.status}, user=${userId}`);
                    throw new BadRequestException('From account is not active');
                }

                if (fromAccount.balance.lt(amountDecimal)) {
                    this.logger.warn(`Transfer: insufficient funds, balance=${fromAccount.balance}, amount=${amount}`);
                    throw new BadRequestException('Insufficient balance');
                }

                const fraudResult = await this.fraudService.evaluateTransfer({
                    userId,
                    fromAccountId,
                    toAccountId,
                    amount: amountDecimal,
                    referenceId,
                    scope: 'TRANSFER',
                });

                if (fraudResult.decision === 'REJECT') {
                    const rejectedTransaction = await tx.transaction.create({
                        data: {
                            type: TransactionType.TRANSFER,
                            actorCustomerId: userId,
                            fromAccountId,
                            toAccountId,
                            amount,
                            referenceId,
                            status: TransactionStatus.REJECTED,
                            fraudDecision: fraudResult.decision,
                            fraudReason: fraudResult.reason,
                        },
                    });

                    await tx.event.create({
                        data: {
                            type: EventType.TRANSACTION_FAILED,
                            payload: this.buildTransactionEventPayload({
                                actorId: userId,
                                resourceId: rejectedTransaction.id,
                                traceId: traceId ?? 'missing-trace-id',
                                outcome: 'FAILURE',
                                reasonCode: 'FRAUD_REJECTED',
                                metadata: {
                                    transactionType: TransactionType.TRANSFER,
                                    referenceId,
                                    amount,
                                    fromAccountId,
                                    toAccountId,
                                    fraudRule: fraudResult.reason,
                                    clientIpMasked,
                                    userAgent,
                                },
                            }),
                            status: EventStatus.PENDING,
                        },
                    });

                    return {
                        kind: 'REJECT',
                        rejectedTransactionId: rejectedTransaction.id,
                        fraudReason: fraudResult.reason,
                    };
                }

                const transaction = await tx.transaction.create({
                    data: {
                        type: TransactionType.TRANSFER,
                        actorCustomerId: userId,
                        fromAccountId,
                        toAccountId,
                        amount,
                        referenceId,
                        status: TransactionStatus.PENDING,
                    },
                });

                await tx.account.update({
                    where: { id: fromAccountId },
                    data: {
                        balance: { decrement: amount },
                    },
                });
                await tx.account.update({
                    where: { id: toAccountId },
                    data: {
                        balance: { increment: amount },
                    },
                });
                const completedTransaction = await tx.transaction.update({
                    where: { id: transaction.id },
                    data: {
                        status: TransactionStatus.COMPLETED,
                    },
                });
                await tx.event.create({
                    data: {
                      type: EventType.TRANSACTION_COMPLETED,
                      payload: this.buildTransactionEventPayload({
                        actorId: userId,
                        resourceId: completedTransaction.id,
                        traceId: traceId ?? 'missing-trace-id',
                        outcome: 'SUCCESS',
                        metadata: {
                          transactionType: TransactionType.TRANSFER,
                          referenceId,
                          amount,
                          fromAccountId,
                          toAccountId,
                          clientIpMasked,
                          userAgent,
                        },
                      }),
                      status: EventStatus.PENDING,
                    },
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
            this.logger.log(`Transfer completed: txId=${result.dto.id}, from=${fromAccountId}, to=${toAccountId}, amount=${amount}`);
            return result.dto;
        }
        catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findFirst({
                    where: { actorCustomerId: userId, referenceId },
                });
                if (byRef) {
                    this.logger.log(`Transfer P2002 idempotent: referenceId=${referenceId}, returned existing transactionId=${byRef.id}, user=${userId}`);
                    return transactionMapper.toResponseDto(byRef);
                }
            }
            throw err;
        }


    }
}
