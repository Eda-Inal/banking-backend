import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [AuthModule],
  providers: [AccountsService],
  controllers: [AccountsController]
})
export class AccountsModule {}
