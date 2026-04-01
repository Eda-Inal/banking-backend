import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Action, AuditOutcome } from '../common/enums';
import { RequestContext } from '../common/request-context/request-context';
import type { TransactionEventMetadata } from '../common/transaction-event.contract';
import { Prisma } from '../generated/prisma/client';
import { StructuredLogger } from '../logger/structured-logger.service';

export type AuditRecordInput = {
    action: Action
    outcome?: AuditOutcome;
    actorId?: string;
    resourceId?: string;
    traceId?: string;
    reasonCode?: string;
    metadata?: Prisma.InputJsonValue;
    customerId: string;
    entityType: string;
    entityId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  };

  @Injectable()
  export class AuditService {
    constructor(
      private readonly prisma: PrismaService,
      private readonly structuredLogger: StructuredLogger,
    ) {}

    recordSuccess(input: AuditRecordInput) {
      return this.record({ ...input, outcome: AuditOutcome.SUCCESS });
    }

    recordFailure(input: AuditRecordInput) {
      return this.record({ ...input, outcome: AuditOutcome.FAILURE });
    }

    private record(input: AuditRecordInput): Promise<void> {
      const ctx = RequestContext.get();

      const actorId = input.actorId ?? input.customerId;
      const resourceId = input.resourceId ?? input.entityId;
      const traceId = input.traceId ?? ctx.traceId;
      const ipAddress = input.ipAddress ?? ctx.clientIpMasked ?? null;
      const userAgent = input.userAgent ?? ctx.userAgent ?? null;

      return this.prisma.auditLog
        .create({
          data: {
            action: input.action,
            outcome: input.outcome,
            customerId: input.customerId,
            entityType: input.entityType,
            entityId: input.entityId,
            actorId,
            resourceId,
            traceId,
            reasonCode: input.reasonCode,
            metadata: input.metadata,
            ipAddress: ipAddress ?? undefined,
            userAgent: userAgent ?? undefined,
          },
        })
        .catch((error: unknown) => {
          this.structuredLogger.error(AuditService.name, 'Audit record write failed', {
            details: {
              eventType: 'AUDIT',
              action: 'RECORD',
              auditAction: input.action,
              outcome: input.outcome ?? null,
              customerId: input.customerId,
              entityType: input.entityType,
              entityId: input.entityId,
            },
            error: error instanceof Error ? error : { message: String(error) },
          });
          throw error;
        }) as unknown as Promise<void>;
    }
  }