import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMqConnection } from './rabbitmq.connection';
import { RabbitMqConsumer } from './rabbitmq.consumer';
import { RabbitMqPublisher } from './rabbitmq.publisher';
import { ProcessedMessageRepository } from './consumer/processed-message.repository';
import { RabbitMqTransactionEventDispatcher } from './consumer/rabbitmq-transaction-event.dispatcher';

@Module({
  imports: [ConfigModule],
  providers: [
    RabbitMqConnection,
    RabbitMqPublisher,
    ProcessedMessageRepository,
    RabbitMqTransactionEventDispatcher,
    RabbitMqConsumer,
  ],
  exports: [RabbitMqConnection, RabbitMqPublisher, RabbitMqConsumer],
})
export class RabbitMqModule {}