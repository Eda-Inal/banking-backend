import { Controller, Get, UseGuards, Param, Post, Body, Patch } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateAccountRequestDto } from './dto/create-account-request.dto';



@Controller('accounts')
@UseGuards(JwtGuard)
export class AccountsController {
    constructor(private readonly accountsService: AccountsService) { }

    @Get()
    async getAccounts(@CurrentUser() user: CurrentUserPayload): Promise<AccountResponseDto[]> {
        return this.accountsService.getAccounts(user.userId);
    }

    @Get(':id')
    async getAccount(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string): Promise<AccountResponseDto> {
        return this.accountsService.getAccountById(user.userId, id);
    }

    @Post()
    async createAccount(@CurrentUser() user: CurrentUserPayload, @Body() createAccountRequestDto: CreateAccountRequestDto): Promise<AccountResponseDto> {
        return this.accountsService.createAccount(user.userId, createAccountRequestDto);
    }

    @Patch(':id/freeze')
    async freezeAccount(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string): Promise<AccountResponseDto> {
        return this.accountsService.freezeAccount(user.userId, id);
    }

    @Patch(':id/unfreeze')
    async unfreezeAccount(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string): Promise<AccountResponseDto> {
        return this.accountsService.unfreezeAccount(user.userId, id);
    }

    @Patch(':id/close')
    async closeAccount(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string): Promise<AccountResponseDto> {
        return this.accountsService.closeAccount(user.userId, id);
    }

}
