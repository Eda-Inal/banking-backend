import { Injectable, NotFoundException, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { accountMapper } from './accounts.mapper';
import { CreateAccountRequestDto } from './dto/create-account-request.dto';
import { AccountStatus } from '../common/enums';
import { RequestContext } from '../common/request-context/request-context';
import { Action as PrismaAction } from '../generated/prisma/enums';



@Injectable()
export class AccountsService {
    private readonly logger = new Logger(AccountsService.name);

    constructor(private readonly prisma: PrismaService) { }

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

    async createAccount(userId: string, createAccountRequestDto: CreateAccountRequestDto): Promise<AccountResponseDto> {
        const { currency } = createAccountRequestDto;
        const { clientIpMasked, userAgent } = RequestContext.get();

        const accountExists = await this.prisma.account.findFirst({
            where: {
                customerId: userId,
                currency,
                status: { not: AccountStatus.CLOSED },
            },
        });
        if (accountExists) {
            this.logger.warn(`createAccount: account already exists for user ${userId}, currency ${currency}`);
            throw new ConflictException(`You already have an account with ${currency}`);
        }

        const account = await this.prisma.account.create({
            data: { customerId: userId, currency },
        });
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_CREATE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: account.id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        this.logger.log(`Account created: ${account.id} for user ${userId}`);
        return accountMapper.toResponseDto(account);
    }

    async freezeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();

        let account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            this.logger.warn(`freezeAccount: account not found for user ${userId}, accountId ${id}`);
            throw new NotFoundException('Account not found');
        }

        if (account.status === AccountStatus.CLOSED) {
            this.logger.warn(`freezeAccount: account is closed for user ${userId}, accountId ${id}`);
            throw new BadRequestException('Account is closed');
        }
        if (account.status === AccountStatus.FROZEN) {
            this.logger.warn(`freezeAccount: account is already frozen for user ${userId}, accountId ${id}`);
            throw new BadRequestException('Account is already frozen');
        }
        account = await this.prisma.account.update({
            where: { id, customerId: userId },
            data: { status: AccountStatus.FROZEN },
        });
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_FREEZE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: account.id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        this.logger.log(`Account frozen: ${id} for user ${userId}`);
        return accountMapper.toResponseDto(account);
    }

    async unfreezeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();

        let account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            this.logger.warn(`unfreezeAccount: account not found for user ${userId}, accountId ${id}`);
            throw new NotFoundException('Account not found');
        }
        if (account.status === AccountStatus.CLOSED) {
            this.logger.warn(`unfreezeAccount: account is closed for user ${userId}, accountId ${id}`);
            throw new BadRequestException('Account is closed');
        }
        if (account.status === AccountStatus.ACTIVE) {
            this.logger.warn(`unfreezeAccount: account is already active for user ${userId}, accountId ${id}`);
            throw new BadRequestException('Account is already active');
        }
        account = await this.prisma.account.update({
            where: { id, customerId: userId },
            data: { status: AccountStatus.ACTIVE },
        });
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_UNFREEZE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: account.id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        this.logger.log(`Account unfrozen: ${id} for user ${userId}`);
        return accountMapper.toResponseDto(account);
    }

    async closeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();

        let account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            this.logger.warn(`closeAccount: account not found for user ${userId}, accountId ${id}`);
            throw new NotFoundException('Account not found');
        }
        if (account.status === AccountStatus.CLOSED) {
            this.logger.warn(`closeAccount: account is already closed for user ${userId}, accountId ${id}`);
            throw new BadRequestException('Account is already closed');
        }
        account = await this.prisma.account.update({
            where: { id, customerId: userId },
            data: { status: AccountStatus.CLOSED },
        });
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_CLOSE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: account.id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        this.logger.log(`Account closed: ${id} for user ${userId}`);
        return accountMapper.toResponseDto(account);
    }
}
