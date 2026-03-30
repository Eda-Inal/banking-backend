import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { Action, EventType, TransactionType } from '../../common/enums';
import { Prisma } from '../../generated/prisma/client';
import type { ConsumedEventMessage } from './consumed-event.types';
import { PermanentConsumerError } from './consumer.errors';
import { validateTransactionEventPayload } from './transaction-event-payload.validator';

@Injectable()
export class RabbitMqTransactionEventDispatcher {
  private readonly logger = new Logger(RabbitMqTransactionEventDispatcher.name);

  constructor(private readonly audit: AuditService) {}

  async dispatch(message: ConsumedEventMessage): Promise<void> {
    switch (message.type) {
      case EventType.TRANSACTION_COMPLETED: {
        const payload = validateTransactionEventPayload(message.payload);

        const txType = payload.metadata.transactionType;
        const action =
          txType === TransactionType.DEPOSIT
            ? Action.DEPOSIT
            : txType === TransactionType.WITHDRAW
              ? Action.WITHDRAW
              : Action.TRANSFER;

        await this.audit.recordSuccess({
          action,
          customerId: payload.actorId,
          entityType: 'TRANSACTION',
          entityId: payload.resourceId,
          actorId: payload.actorId,
          resourceId: payload.resourceId,
          traceId: payload.traceId,
          ipAddress: payload.metadata.clientIpMasked ?? null,
          userAgent: payload.metadata.userAgent ?? null,
          metadata: payload.metadata as Prisma.InputJsonValue,
        });

        this.logger.log(
          `Handled TRANSACTION_COMPLETED tx=${payload.resourceId} actor=${payload.actorId} trace=${payload.traceId}`,
        );
        return;
      }

      case EventType.TRANSACTION_FAILED: {
        const payload = validateTransactionEventPayload(message.payload);

        const txType = payload.metadata.transactionType;
        const action =
          txType === TransactionType.DEPOSIT
            ? Action.DEPOSIT
            : txType === TransactionType.WITHDRAW
              ? Action.WITHDRAW
              : Action.TRANSFER;

        await this.audit.recordFailure({
          action,
          customerId: payload.actorId,
          entityType: 'TRANSACTION',
          entityId: payload.resourceId,
          actorId: payload.actorId,
          resourceId: payload.resourceId,
          traceId: payload.traceId,
          reasonCode: payload.reasonCode,
          ipAddress: payload.metadata.clientIpMasked ?? null,
          userAgent: payload.metadata.userAgent ?? null,
          metadata: payload.metadata as Prisma.InputJsonValue,
        });

        this.logger.warn(
          `Handled TRANSACTION_FAILED tx=${payload.resourceId} actor=${payload.actorId} trace=${payload.traceId} reasonCode=${payload.reasonCode ?? 'n/a'}`,
        );
        return;
      }

      default:
        throw new PermanentConsumerError(`unsupported event type: ${message.type}`);
    }
  }
}
