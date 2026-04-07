import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMqModule } from '../../messaging/rabbitmq.module';
import { EmailConsumer } from './email.consumer';
import { EmailProcessedMessageRepository } from './email-processed-message.repository';
import { EmailService } from './email.service';
import { SmtpEmailTransport } from './smtp-email.transport';
import { SendgridEmailTransport } from './sendgrid-email.transport';

@Module({
  imports: [ConfigModule, RabbitMqModule],
  providers: [
    EmailService,
    SmtpEmailTransport,
    SendgridEmailTransport,
    EmailProcessedMessageRepository,
    EmailConsumer,
  ],
  exports: [EmailService],
})
export class EmailModule {}
