import { Controller, UseGuards, Post, Body } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateDepositRequestDto } from './dto/create-deposit-request';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { CreateWithdrawRequestDto } from './dto/create-withdraw-request';

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) { }

  @Post('deposit')
  async createDeposit(@CurrentUser() user: CurrentUserPayload, @Body() createDepositRequestDto: CreateDepositRequestDto): Promise<TransactionResponseDto> {

    return this.transactionsService.createDeposit(user.userId, createDepositRequestDto);
  }

  @Post('withdraw')
  async createWithdraw(@CurrentUser() user: CurrentUserPayload, @Body() createWithdrawRequestDto: CreateWithdrawRequestDto): Promise<TransactionResponseDto> {
    return this.transactionsService.createWithdraw(user.userId, createWithdrawRequestDto);
  }
}
