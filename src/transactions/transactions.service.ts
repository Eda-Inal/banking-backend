 import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepositRequestDto } from './dto/create-deposit-request';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { transactionMapper } from './transactions.mapper';
import { TransactionType, TransactionStatus, AccountStatus, Action, EventType, EventStatus } from '../common/enums';
import { Prisma } from '../generated/prisma/client';
import { CreateWithdrawRequestDto } from './dto/create-withdraw-request';
import { CreateTransferRequestDto } from './dto/create-transfer-request';
import { RequestContext } from '../common/request-context/request-context';
import { FraudService } from '../fraud/fraud.service';

@Injectable()
export class TransactionsService {
    private readonly logger = new Logger(TransactionsService.name);

    constructor(private readonly prisma: PrismaService, private readonly fraudService: FraudService) { }

    async createDeposit(userId: string, createDepositRequestDto: CreateDepositRequestDto): Promise<TransactionResponseDto> {
        const { amount, referenceId, toAccountId } = createDepositRequestDto;
        const { clientIpMasked, userAgent } = RequestContext.get();

        const existing = await this.prisma.transaction.findUnique({
            where: { referenceId }
        })
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
                        payload: {
                            transactionId: transaction.id,
                            type: TransactionType.DEPOSIT,
                            status: TransactionStatus.COMPLETED,
                            toAccountId,
                            amount,
                            referenceId,
                            createdAt: transaction.createdAt,
                        },
                        status: EventStatus.PENDING,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        action: Action.DEPOSIT,
                        customerId: userId,
                        entityType: 'TRANSACTION',
                        entityId: transaction.id,
                        ipAddress: clientIpMasked,
                        userAgent,
                    },
                });

                return transactionMapper.toResponseDto(completedTransaction);
            });
            this.logger.log(`Deposit completed: transactionId=${result.id}, toAccountId=${toAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`);
            return result;
        } catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findUnique({ where: { referenceId } });
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
        const { clientIpMasked, userAgent } = RequestContext.get();

        const existing = await this.prisma.transaction.findUnique({
            where: { referenceId },
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
              throw new BadRequestException('Withdraw rejected by fraud check');
            }
          }
        try {

            const result = await this.prisma.$transaction(async (tx) => {
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
                        fromAccountId,
                        toAccountId: null,
                        amount,
                        referenceId,
                        status: TransactionStatus.REJECTED,
                        fraudDecision: fraudResult.decision,
                        fraudReason: fraudResult.reason,
                      },
                    });
                  
                    await tx.auditLog.create({
                      data: {
                        action: Action.WITHDRAW,
                        customerId: userId,
                        entityType: 'TRANSACTION',
                        entityId: rejectedTransaction.id,
                        ipAddress: clientIpMasked,
                        userAgent,
                      },
                    });
                  
                    throw new BadRequestException('Withdraw rejected by fraud check');
                  }

                const transaction = await tx.transaction.create({
                    data: {
                        type: TransactionType.WITHDRAW,
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
                        payload: {
                            transactionId: transaction.id,
                            type: TransactionType.WITHDRAW,
                            status: TransactionStatus.COMPLETED,
                            fromAccountId,
                            amount,
                            referenceId,
                            createdAt: transaction.createdAt,
                        },
                        status: EventStatus.PENDING,
                    },
                });
                await tx.auditLog.create({
                    data: {
                        action: Action.WITHDRAW,
                        customerId: userId,
                        entityType: 'TRANSACTION',
                        entityId: transaction.id,
                        ipAddress: clientIpMasked,
                        userAgent,
                    },
                });
                return transactionMapper.toResponseDto(completedTransaction);



            });
            this.logger.log(`Withdraw completed: transactionId=${result.id}, fromAccountId=${fromAccountId}, amount=${amount}, referenceId=${referenceId}, user=${userId}`);
            return result;


        } catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findUnique({ where: { referenceId } });
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
        const { clientIpMasked, userAgent } = RequestContext.get();


        const existing = await this.prisma.transaction.findUnique({
            where: { referenceId }
        })
        if (existing) {
            if (existing.status === TransactionStatus.COMPLETED) {
                this.logger.log(`Transfer idempotent: referenceId ${referenceId}, transactionId ${existing.id}, user ${userId}`);
                return transactionMapper.toResponseDto(existing);
            }
            if (existing.status === TransactionStatus.REJECTED && existing.fraudDecision === 'REJECT') {
                this.logger.warn(`Transfer idempotent rejected: referenceId=${referenceId}, transactionId=${existing.id}, user=${userId}`);
                throw new BadRequestException('Transfer rejected by fraud check');
            }
        }
        try {

            const result = await this.prisma.$transaction(async (tx) => {

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
                            fromAccountId,
                            toAccountId,
                            amount,
                            referenceId,
                            status: TransactionStatus.REJECTED,
                            fraudDecision: fraudResult.decision,
                            fraudReason: fraudResult.reason,
                        },
                    });

                    await tx.auditLog.create({
                        data: {
                            action: Action.TRANSFER,
                            customerId: userId,
                            entityType: 'TRANSACTION',
                            entityId: rejectedTransaction.id,
                            ipAddress: clientIpMasked,
                            userAgent,
                        },
                    });

                    throw new BadRequestException('Transfer rejected by fraud check');
                }

                const transaction = await tx.transaction.create({
                    data: {
                        type: TransactionType.TRANSFER,
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
                        payload: {
                            transactionId: transaction.id,
                            type: TransactionType.TRANSFER,
                            status: TransactionStatus.COMPLETED,
                            fromAccountId,
                            toAccountId,
                            amount,
                            referenceId,
                            createdAt: transaction.createdAt,
                        },
                        status: EventStatus.PENDING,
                    },
                });
                await tx.auditLog.create({
                    data: {
                        action: Action.TRANSFER,
                        customerId: userId,
                        entityType: 'TRANSACTION',
                        entityId: transaction.id,
                        ipAddress: clientIpMasked,
                        userAgent,
                    },
                });
                return transactionMapper.toResponseDto(completedTransaction);
            });
            this.logger.log(`Transfer completed: txId=${result.id}, from=${fromAccountId}, to=${toAccountId}, amount=${amount}`);
            return result;
        }
        catch (err) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (isP2002) {
                const byRef = await this.prisma.transaction.findUnique({ where: { referenceId } });
                if (byRef) {
                    this.logger.log(`Transfer P2002 idempotent: referenceId=${referenceId}, returned existing transactionId=${byRef.id}, user=${userId}`);
                    return transactionMapper.toResponseDto(byRef);
                }
            }
            throw err;
        }


    }
}
