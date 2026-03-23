import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { CONFIG_KEYS } from '../config/config';

@Injectable()
export class RabbitMqConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConnection.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>(CONFIG_KEYS.RABBITMQ_URL);
    if (!url) {
      throw new Error('RABBITMQ_URL is required');
    }

    const connection = await connect(url);
    this.connection = connection;
    this.channel = await connection.createChannel();
    await this.setupTopology(this.channel);

    connection.on('error', (err) => {
      this.logger.error(`RabbitMQ connection error: ${err.message}`);
    });

    connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
    });

    this.logger.log('RabbitMQ connected');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }
    return this.channel;
  }

  isReady(): boolean {
    return this.connection !== null && this.channel !== null;
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

    this.logger.log(
      `RabbitMQ topology ready exchange=${exchange} queue=${queue} dlx=${dlx} dlq=${dlq}`,
    );
  }
}