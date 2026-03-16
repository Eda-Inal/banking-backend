import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { accountMapper } from './accounts.mapper';




@Injectable()
export class AccountsService {
    private readonly logger = new Logger(AccountsService.name);

    constructor(private readonly prisma: PrismaService) {}
    
    async getAccounts(userId: string): Promise<AccountResponseDto[]> {
        const accounts = await this.prisma.account.findMany({
            where: { customerId: userId },
        });

        this.logger.log(`Accounts fetched for user ${userId} (count: ${accounts.length})`);

        return accounts.map(accountMapper.toResponseDto);
    }

    async getAccountById(userId: string, id: string): Promise<AccountResponseDto> {
        const account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            this.logger.warn(`getAccountById: account not found for user ${userId}, accountId ${id}`);
            throw new NotFoundException('Account not found');
        }

        this.logger.log(`Account fetched: ${id} for user ${userId}`);

        return accountMapper.toResponseDto(account);
    }
}
