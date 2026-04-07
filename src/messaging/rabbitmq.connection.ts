import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type Channel, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { CONFIG_KEYS } from '../config/config';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class RabbitMqConnection implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private publisherChannel: ConfirmChannel | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>(CONFIG_KEYS.RABBITMQ_URL);
    if (!url) {
      throw new Error('RABBITMQ_URL is required');
    }

    const connection = await connect(url);
    this.connection = connection;
    this.channel = await connection.createChannel();
    this.publisherChannel = await connection.createConfirmChannel();
    await this.setupTopology(this.channel);

    connection.on('error', (err) => {
      this.structuredLogger.error(RabbitMqConnection.name, 'RabbitMQ connection error', {
        details: { eventType: 'MESSAGING', action: 'RABBITMQ_CONNECTION_ERROR' },
        error: err,
      });
    });

    connection.on('close', () => {
      this.structuredLogger.warn(RabbitMqConnection.name, 'RabbitMQ connection closed', {
        eventType: 'MESSAGING',
        action: 'RABBITMQ_CONNECTION_CLOSE',
      });
    });

    this.structuredLogger.info(RabbitMqConnection.name, 'RabbitMQ connected', {
      eventType: 'MESSAGING',
      action: 'RABBITMQ_CONNECTED',
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.publisherChannel) {
      await this.publisherChannel.close().catch((err: unknown) => {
        this.structuredLogger.warn(RabbitMqConnection.name, 'RabbitMQ publisher channel close error', {
          eventType: 'MESSAGING',
          action: 'RABBITMQ_PUBLISHER_CHANNEL_CLOSE_ERROR',
          failure: (err as Error)?.message ?? String(err),
        });
      });
      this.publisherChannel = null;
    }

    if (this.channel) {
      await this.channel.close().catch((err: unknown) => {
        this.structuredLogger.warn(RabbitMqConnection.name, 'RabbitMQ channel close error', {
          eventType: 'MESSAGING',
          action: 'RABBITMQ_CHANNEL_CLOSE_ERROR',
          failure: (err as Error)?.message ?? String(err),
        });
      });
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close().catch((err: unknown) => {
        this.structuredLogger.warn(RabbitMqConnection.name, 'RabbitMQ connection close error', {
          eventType: 'MESSAGING',
          action: 'RABBITMQ_CONNECTION_CLOSE_ERROR',
          failure: (err as Error)?.message ?? String(err),
        });
      });
      this.connection = null;
    }

    this.structuredLogger.info(RabbitMqConnection.name, 'RabbitMQ disconnected', {
      eventType: 'MESSAGING',
      action: 'RABBITMQ_DISCONNECTED',
    });
  }

  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }
    return this.channel;
  }

  getPublisherChannel(): ConfirmChannel {
    if (!this.publisherChannel) {
      throw new Error('RabbitMQ publisher channel is not initialized');
    }
    return this.publisherChannel;
  }

  isReady(): boolean {
    return (
      this.connection !== null &&
      this.channel !== null &&
      this.publisherChannel !== null
    );
  }

  private async setupTopology(channel: Channel): Promise<void> {
    const exchange =
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_EXCHANGE) ??
      'banking.events';
    const queue =
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_QUEUE) ??
      'banking.events.q';
    const dlx =
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_DLX) ??
      'banking.events.dlx';
    const dlq =
      this.config.get<string>(CONFIG_KEYS.RABBITMQ_EVENTS_DLQ) ??
      'banking.events.dlq';

    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertExchange(dlx, 'topic', { durable: true });

    await channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: dlx,
      deadLetterRoutingKey: 'dead.letter',
    });
    await channel.assertQueue(dlq, { durable: true });

    await channel.bindQueue(queue, exchange, '#');
    await channel.bindQueue(dlq, dlx, 'dead.letter');

    this.structuredLogger.info(RabbitMqConnection.name, 'RabbitMQ topology ready', {
      eventType: 'MESSAGING',
      action: 'RABBITMQ_TOPOLOGY_READY',
      exchange,
      queue,
      dlx,
      dlq,
    });
  }
}