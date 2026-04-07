import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ConsumeMessage } from 'amqplib';
import { EventType } from '../../common/enums';
import { CONFIG_KEYS } from '../../config/config';
import { StructuredLogger } from '../../logger/structured-logger.service';
import { RabbitMqConnection } from '../../messaging/rabbitmq.connection';
import { isTransientConsumerError } from '../../messaging/consumer/consumer-error.classifier';
import { PermanentConsumerError } from '../../messaging/consumer/consumer.errors';
import { parseConsumedEventMessage } from '../../messaging/consumer/rabbitmq-event-message.parser';
import {
  getConsumeMessageAttempts,
  republishForRetry,
} from '../../messaging/consumer/rabbitmq-retry.helper';
import { validateTransactionEventPayload } from '../../messaging/consumer/transaction-event-payload.validator';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProcessedMessageRepository } from './email-processed-message.repository';
import { EmailService } from './email.service';
import {
  buildTransactionEmailContent,
  buildWelcomeEmailContent,
} from './email-content.builder';

@Injectable()
export class EmailConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly prefetchCount: number;
  private readonly maxRetries: number;
  private consumerTag: string | null = null;
  private bootstrapTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbit: RabbitMqConnection,
    private readonly prisma: PrismaService,
    private readonly processedMessages: EmailProcessedMessageRepository,
    private readonly emailService: EmailService,
    private readonly structuredLogger: StructuredLogger,
  ) {
    this.prefetchCount = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_PREFETCH),
      10,
    );
    this.maxRetries = this.parsePositiveInt(
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_CONSUMER_MAX_RETRIES),
      5,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.tryStartConsumer();
    if (this.consumerTag) return;

    this.bootstrapTimer = setInterval(() => {
      void this.tryStartConsumer();
    }, 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bootstrapTimer) {
      clearInterval(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }

    if (!this.consumerTag) return;

    try {
      const channel = this.rabbit.getChannel();
      await channel.cancel(this.consumerTag);
      this.structuredLogger.info(EmailConsumer.name, 'Email consumer stopped', {
        eventType: 'EMAIL',
        action: 'CONSUMER_STOP',
      });
    } catch (error) {
      this.structuredLogger.warn(EmailConsumer.name, 'Email consumer stop failed', {
        eventType: 'EMAIL',
        action: 'CONSUMER_STOP_FAILED',
        failure: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.consumerTag = null;
    }
  }

  private async handleMessage(
    channel: Channel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (!msg) return;

    let claimedMessageId: string | null = null;
    try {
      const parsed = parseConsumedEventMessage(msg.content);
      const messageId = msg.properties.messageId ?? parsed.eventId;
      const eventType = parsed.type ?? 'UNKNOWN';

      if (!messageId) {
        throw new PermanentConsumerError('messageId is missing');
      }

      const claimed = await this.processedMessages.claim(messageId, eventType);
      if (!claimed) {
        this.structuredLogger.warn(EmailConsumer.name, 'Email duplicate skipped', {
          eventType: 'EMAIL',
          action: 'CONSUME_DUPLICATE',
          messageId,
        });
        channel.ack(msg);
        return;
      }
      claimedMessageId = messageId;

      await this.dispatchEmail(parsed.type, parsed.payload);
      await this.processedMessages.markCompleted(messageId);
      channel.ack(msg);

      this.structuredLogger.info(EmailConsumer.name, 'Email consumer ack', {
        eventType: 'EMAIL',
        action: 'CONSUME_ACK',
        messageId,
        messageType: eventType,
      });
    } catch (error) {
      if (claimedMessageId) {
        await this.processedMessages.markFailed(
          claimedMessageId,
          error instanceof Error ? error.message : String(error),
        );
      }

      const messageId = msg.properties.messageId ?? 'unknown';
      const isTransient = isTransientConsumerError(error);
      const currentAttempts = getConsumeMessageAttempts(msg);
      const nextAttempts = currentAttempts + 1;

      if (isTransient && nextAttempts <= this.maxRetries) {
        const republished = republishForRetry(channel, msg, nextAttempts);
        if (republished) {
          channel.ack(msg);
          this.structuredLogger.warn(EmailConsumer.name, 'Email retry scheduled', {
            eventType: 'EMAIL',
            action: 'CONSUME_RETRY',
            messageId,
            attempt: nextAttempts,
            maxRetries: this.maxRetries,
            failure: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }

      const requeue = false;
      this.structuredLogger.error(EmailConsumer.name, 'Email consumer nack', {
        details: {
          eventType: 'EMAIL',
          action: 'CONSUME_NACK',
          messageId,
          requeue,
          attempt: nextAttempts,
          maxRetries: this.maxRetries,
        },
        error: error instanceof Error ? error : { message: String(error) },
      });
      channel.nack(msg, false, requeue);
    }
  }

  private async dispatchEmail(type: string | undefined, payload: unknown): Promise<void> {
    switch (type) {
      case EventType.TRANSACTION_COMPLETED:
      case EventType.TRANSACTION_FAILED: {
        const validated = validateTransactionEventPayload(payload);
        const customer = await this.prisma.customer.findUnique({
          where: { id: validated.actorId },
          select: { email: true, name: true },
        });
        if (!customer) {
          throw new PermanentConsumerError(`customer not found: ${validated.actorId}`);
        }

        const content = buildTransactionEmailContent({
          customerName: customer.name,
          eventType: type,
          transactionType: validated.metadata.transactionType,
          transactionId: validated.resourceId,
          amount: validated.metadata.amount,
          reasonCode: validated.reasonCode,
        });

        await this.emailService.send({
          to: customer.email,
          subject: content.subject,
          text: content.text,
        });

        this.structuredLogger.info(EmailConsumer.name, 'Email dispatched', {
          eventType: 'EMAIL',
          action: 'DISPATCH_SUCCESS',
          customerId: validated.actorId,
          recipientMasked: this.maskEmail(customer.email),
          transactionId: validated.resourceId,
          messageType: type,
          traceId: validated.traceId,
        });
        return;
      }
      case EventType.USER_REGISTERED: {
        const validated = this.validateUserRegisteredPayload(payload);
        const customer = await this.prisma.customer.findUnique({
          where: { id: validated.actorId },
          select: { email: true, name: true },
        });
        if (!customer) {
          throw new PermanentConsumerError(`customer not found: ${validated.actorId}`);
        }

        const content = buildWelcomeEmailContent({
          customerName: customer.name,
        });

        await this.emailService.send({
          to: customer.email,
          subject: content.subject,
          text: content.text,
        });

        this.structuredLogger.info(EmailConsumer.name, 'Welcome email dispatched', {
          eventType: 'EMAIL',
          action: 'WELCOME_DISPATCH_SUCCESS',
          customerId: validated.actorId,
          recipientMasked: this.maskEmail(customer.email),
          messageType: type,
          traceId: validated.traceId,
        });
        return;
      }
      default:
        throw new PermanentConsumerError(`unsupported email event type: ${type ?? 'unknown'}`);
    }
  }

  private async tryStartConsumer(): Promise<void> {
    if (this.consumerTag) return;
    if (!this.rabbit.isReady()) return;

    try {
      const channel = this.rabbit.getChannel();
      const queue =
        this.config.get<string>(CONFIG_KEYS.RABBITMQ_EMAIL_QUEUE) ??
        'notifications.email.q';
      await channel.prefetch(this.prefetchCount);

      const consumeOk = await channel.consume(
        queue,
        (msg) => {
          void this.handleMessage(channel, msg);
        },
        { noAck: false },
      );

      this.consumerTag = consumeOk.consumerTag;
      if (this.bootstrapTimer) {
        clearInterval(this.bootstrapTimer);
        this.bootstrapTimer = null;
      }

      this.structuredLogger.info(EmailConsumer.name, 'Email consumer started', {
        eventType: 'EMAIL',
        action: 'CONSUMER_START',
        queue,
        prefetch: this.prefetchCount,
      });
    } catch (error) {
      this.structuredLogger.warn(EmailConsumer.name, 'Email consumer bootstrap retry', {
        eventType: 'EMAIL',
        action: 'CONSUMER_BOOTSTRAP_RETRY',
        failure: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'invalid-email';
    if (name.length <= 2) return `**@${domain}`;
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
  }

  private validateUserRegisteredPayload(payload: unknown): {
    actorId: string;
    resourceId: string;
    traceId: string;
  } {
    if (!payload || typeof payload !== 'object') {
      throw new PermanentConsumerError('invalid user registered payload: not an object');
    }
    const p = payload as Record<string, unknown>;
    const actorId = typeof p.actorId === 'string' ? p.actorId.trim() : '';
    const resourceId = typeof p.resourceId === 'string' ? p.resourceId.trim() : '';
    const traceId = typeof p.traceId === 'string' ? p.traceId.trim() : '';

    if (!actorId) {
      throw new PermanentConsumerError('invalid user registered payload: actorId');
    }
    if (!resourceId) {
      throw new PermanentConsumerError('invalid user registered payload: resourceId');
    }
    if (!traceId) {
      throw new PermanentConsumerError('invalid user registered payload: traceId');
    }
    return { actorId, resourceId, traceId };
  }
}
