import { Injectable } from '@nestjs/common';
import { EventStatus, EventType, TransactionType } from '../common/enums';
import type {
  TransactionEventMetadata,
  TransactionEventPayload,
} from '../common/transaction-event.contract';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class TransactionEventWriter {
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

  async createCompletedEvent(params: {
    tx: Prisma.TransactionClient;
    actorId: string;
    resourceId: string;
    traceId?: string;
    transactionType: TransactionType;
    referenceId: string;
    amount: number;
    fromAccountId: string | null;
    toAccountId: string | null;
    clientIpMasked?: string;
    userAgent?: string;
  }) {
    const {
      tx,
      actorId,
      resourceId,
      traceId,
      transactionType,
      referenceId,
      amount,
      fromAccountId,
      toAccountId,
      clientIpMasked,
      userAgent,
    } = params;

    await tx.event.create({
      data: {
        type: EventType.TRANSACTION_COMPLETED,
        payload: this.buildTransactionEventPayload({
          actorId,
          resourceId,
          traceId: traceId ?? 'missing-trace-id',
          outcome: 'SUCCESS',
          metadata: {
            transactionType,
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
  }

  async createFailedFraudEvent(params: {
    tx: Prisma.TransactionClient;
    actorId: string;
    resourceId: string;
    traceId?: string;
    transactionType: TransactionType;
    referenceId: string;
    amount: number;
    fromAccountId: string | null;
    toAccountId: string | null;
    fraudRule?: string;
    clientIpMasked?: string;
    userAgent?: string;
  }) {
    const {
      tx,
      actorId,
      resourceId,
      traceId,
      transactionType,
      referenceId,
      amount,
      fromAccountId,
      toAccountId,
      fraudRule,
      clientIpMasked,
      userAgent,
    } = params;

    await tx.event.create({
      data: {
        type: EventType.TRANSACTION_FAILED,
        payload: this.buildTransactionEventPayload({
          actorId,
          resourceId,
          traceId: traceId ?? 'missing-trace-id',
          outcome: 'FAILURE',
          reasonCode: 'FRAUD_REJECTED',
          metadata: {
            transactionType,
            referenceId,
            amount,
            fromAccountId,
            toAccountId,
            fraudRule,
            clientIpMasked,
            userAgent,
          },
        }),
        status: EventStatus.PENDING,
      },
    });
  }
}

