import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CONFIG_KEYS } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TransientConsumerError } from './consumer.errors';
import { StructuredLogger } from '../../logger/structured-logger.service';

@Injectable()
export class ProcessedMessageRepository {
  private readonly consumerName = 'banking-backend';
  private readonly claimTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {
    this.claimTtlMs = this.parsePositiveInt(
      config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_CLAIM_TTL_MS),
      300000,
    );
  }

  async claim(messageId: string, eventType: string): Promise<boolean> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<{ claimed: number }>>`
      WITH inserted AS (
        INSERT INTO "processed_messages" (
          "id",
          "message_id",
          "event_type",
          "consumer",
          "status",
          "claimed_at",
          "processed_at",
          "updated_at"
        )
        VALUES (
          ${id}::uuid,
          ${messageId},
          ${eventType},
          ${this.consumerName},
          'CLAIMED'::"ProcessedMessageStatus",
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT ("consumer", "message_id") DO NOTHING
        RETURNING 1
      ),
      reclaimed AS (
        UPDATE "processed_messages"
        SET
          "status" = 'CLAIMED'::"ProcessedMessageStatus",
          "event_type" = ${eventType},
          "claimed_at" = NOW(),
          "last_error" = NULL,
          "updated_at" = NOW()
        WHERE "consumer" = ${this.consumerName}
          AND "message_id" = ${messageId}
          AND (
            "status" = 'FAILED'::"ProcessedMessageStatus"
            OR (
              "status" = 'CLAIMED'::"ProcessedMessageStatus"
              AND "claimed_at" < NOW() - (${this.claimTtlMs} * INTERVAL '1 millisecond')
            )
          )
        RETURNING 1
      )
      SELECT COUNT(*)::int AS claimed FROM (
        SELECT 1 FROM inserted
        UNION ALL
        SELECT 1 FROM reclaimed
      ) AS claims
    `;

    return Number(rows[0]?.claimed ?? 0) > 0;
  }

  async markCompleted(messageId: string): Promise<void> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "processed_messages"
      SET
        "status" = 'COMPLETED'::"ProcessedMessageStatus",
        "completed_at" = NOW(),
        "processed_at" = NOW(),
        "updated_at" = NOW()
      WHERE "consumer" = ${this.consumerName}
        AND "message_id" = ${messageId}
        AND "status" = 'CLAIMED'::"ProcessedMessageStatus"
    `;

    if (Number(updated) !== 1) {
      throw new TransientConsumerError(
        `failed to finalize processed message as COMPLETED messageId=${messageId}`,
      );
    }
  }

  async markFailed(messageId: string, errorMessage: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "processed_messages"
        SET
          "status" = 'FAILED'::"ProcessedMessageStatus",
          "last_error" = ${errorMessage},
          "updated_at" = NOW()
        WHERE "consumer" = ${this.consumerName}
          AND "message_id" = ${messageId}
      `;
    } catch (error) {
      this.structuredLogger.error(ProcessedMessageRepository.name, 'Failed to mark processed message as FAILED', {
        details: {
          eventType: 'MESSAGING',
          action: 'MARK_FAILED',
          messageId,
        },
        error: error instanceof Error ? error : { message: String(error) },
      });
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
