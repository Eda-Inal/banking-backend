import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { Action, EventType, TransactionType } from '../../common/enums';
import { Prisma } from '../../generated/prisma/client';
import type { ConsumedEventMessage } from './consumed-event.types';
import { PermanentConsumerError } from './consumer.errors';
import { validateTransactionEventPayload } from './transaction-event-payload.validator';
import { StructuredLogger } from '../../logger/structured-logger.service';

@Injectable()
export class RabbitMqTransactionEventDispatcher {
  constructor(
    private readonly audit: AuditService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

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

        this.structuredLogger.info(RabbitMqTransactionEventDispatcher.name, 'Handled TRANSACTION_COMPLETED', {
          eventType: 'MESSAGING',
          action: 'DISPATCH_COMPLETED',
          transactionId: payload.resourceId,
          actorId: payload.actorId,
          traceId: payload.traceId,
        });
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

        this.structuredLogger.warn(RabbitMqTransactionEventDispatcher.name, 'Handled TRANSACTION_FAILED', {
          eventType: 'MESSAGING',
          action: 'DISPATCH_FAILED',
          transactionId: payload.resourceId,
          actorId: payload.actorId,
          traceId: payload.traceId,
          reasonCode: payload.reasonCode ?? null,
        });
        return;
      }

      default:
        throw new PermanentConsumerError(`unsupported event type: ${message.type}`);
    }
  }
}
