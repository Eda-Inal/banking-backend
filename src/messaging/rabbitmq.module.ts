import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMqConnection } from './rabbitmq.connection';
import { RabbitMqConsumer } from './rabbitmq.consumer';
import { RabbitMqPublisher } from './rabbitmq.publisher';

@Module({
  imports: [ConfigModule],
  providers: [RabbitMqConnection, RabbitMqPublisher, RabbitMqConsumer],
  exports: [RabbitMqConnection, RabbitMqPublisher, RabbitMqConsumer],
})
export class RabbitMqModule {}