import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { accountMapper } from './accounts.mapper';
import { CreateAccountRequestDto } from './dto/create-account-request.dto';
import { AccountStatus } from '../common/enums';
import { RequestContext } from '../common/request-context/request-context';
import { Action as PrismaAction } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { StructuredLogger } from '../logger/structured-logger.service';



@Injectable()
export class AccountsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly structuredLogger: StructuredLogger,
    ) { }

    async getAccounts(userId: string): Promise<AccountResponseDto[]> {
        const accounts = await this.prisma.account.findMany({
            where: { customerId: userId },
        });

        this.structuredLogger.info(AccountsService.name, 'Accounts fetched', {
            eventType: 'ACCOUNT',
            action: 'LIST',
            userId,
            count: accounts.length,
        });

        return accounts.map(accountMapper.toResponseDto);
    }

    async getAccountById(userId: string, id: string): Promise<AccountResponseDto> {
        const account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            this.structuredLogger.warn(AccountsService.name, 'Account not found', {
                eventType: 'ACCOUNT',
                action: 'GET_BY_ID',
                userId,
                accountId: id,
            });
            throw new NotFoundException('Account not found');
        }

        this.structuredLogger.info(AccountsService.name, 'Account fetched', {
            eventType: 'ACCOUNT',
            action: 'GET_BY_ID',
            userId,
            accountId: id,
        });

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
            this.structuredLogger.warn(AccountsService.name, 'Account already exists', {
                eventType: 'ACCOUNT',
                action: 'CREATE',
                userId,
                currency,
            });
            throw new ConflictException(`You already have an account with ${currency}`);
        }

        let account;
        try {
            account = await this.prisma.account.create({
                data: { customerId: userId, currency },
            });
        } catch (err) {
            const isP2002 =
                err instanceof Error &&
                'code' in err &&
                (err as { code?: string }).code === 'P2002';
            if (isP2002) {
                // Backstop for concurrent account creation attempts:
                // Prisma schema cannot express this conditional uniqueness, so a DB partial unique
                // index (added via SQL migration) enforces one non-CLOSED account per user/currency.
                this.structuredLogger.warn(AccountsService.name, 'Account create unique conflict', {
                    eventType: 'ACCOUNT',
                    action: 'CREATE',
                    userId,
                    currency,
                    code: 'P2002',
                });
                throw new ConflictException(`You already have an account with ${currency}`);
            }
            throw err;
        }
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
        this.structuredLogger.info(AccountsService.name, 'Account created', {
            eventType: 'ACCOUNT',
            action: 'CREATE',
            userId,
            accountId: account.id,
            currency,
        });
        return accountMapper.toResponseDto(account);
    }

    async freezeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();
        const updated = await this.prisma.account.updateMany({
            where: {
                id,
                customerId: userId,
                status: AccountStatus.ACTIVE,
            },
            data: { status: AccountStatus.FROZEN },
        });
        if (updated.count !== 1) {
            const account = await this.prisma.account.findFirst({
                where: { id, customerId: userId },
            });
            if (!account) {
                this.structuredLogger.warn(AccountsService.name, 'Freeze failed: account not found', { eventType: 'ACCOUNT', action: 'FREEZE', userId, accountId: id });
                throw new NotFoundException('Account not found');
            }
            if (account.status === AccountStatus.CLOSED) {
                this.structuredLogger.warn(AccountsService.name, 'Freeze failed: account is closed', { eventType: 'ACCOUNT', action: 'FREEZE', userId, accountId: id });
                throw new BadRequestException('Account is closed');
            }
            if (account.status === AccountStatus.FROZEN) {
                this.structuredLogger.warn(AccountsService.name, 'Freeze skipped: already frozen', { eventType: 'ACCOUNT', action: 'FREEZE', userId, accountId: id });
                throw new BadRequestException('Account is already frozen');
            }
            throw new BadRequestException('Account state changed, try again');
        }
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_FREEZE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        const account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            throw new NotFoundException('Account not found');
        }
        this.structuredLogger.info(AccountsService.name, 'Account frozen', { eventType: 'ACCOUNT', action: 'FREEZE', userId, accountId: id });
        return accountMapper.toResponseDto(account);
    }

    async unfreezeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();
        const updated = await this.prisma.account.updateMany({
            where: {
                id,
                customerId: userId,
                status: AccountStatus.FROZEN,
            },
            data: { status: AccountStatus.ACTIVE },
        });
        if (updated.count !== 1) {
            const account = await this.prisma.account.findFirst({
                where: { id, customerId: userId },
            });
            if (!account) {
                this.structuredLogger.warn(AccountsService.name, 'Unfreeze failed: account not found', { eventType: 'ACCOUNT', action: 'UNFREEZE', userId, accountId: id });
                throw new NotFoundException('Account not found');
            }
            if (account.status === AccountStatus.CLOSED) {
                this.structuredLogger.warn(AccountsService.name, 'Unfreeze failed: account is closed', { eventType: 'ACCOUNT', action: 'UNFREEZE', userId, accountId: id });
                throw new BadRequestException('Account is closed');
            }
            if (account.status === AccountStatus.ACTIVE) {
                this.structuredLogger.warn(AccountsService.name, 'Unfreeze skipped: already active', { eventType: 'ACCOUNT', action: 'UNFREEZE', userId, accountId: id });
                throw new BadRequestException('Account is already active');
            }
            throw new BadRequestException('Account state changed, try again');
        }
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_UNFREEZE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        const account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            throw new NotFoundException('Account not found');
        }
        this.structuredLogger.info(AccountsService.name, 'Account unfrozen', { eventType: 'ACCOUNT', action: 'UNFREEZE', userId, accountId: id });
        return accountMapper.toResponseDto(account);
    }

    async closeAccount(userId: string, id: string): Promise<AccountResponseDto> {
        const { clientIpMasked, userAgent } = RequestContext.get();
        const updated = await this.prisma.account.updateMany({
            where: {
                id,
                customerId: userId,
                status: { in: [AccountStatus.ACTIVE, AccountStatus.FROZEN] },
                balance: new Prisma.Decimal(0),
            },
            data: { status: AccountStatus.CLOSED },
        });
        if (updated.count !== 1) {
            const account = await this.prisma.account.findFirst({
                where: { id, customerId: userId },
            });
            if (!account) {
                this.structuredLogger.warn(AccountsService.name, 'Close failed: account not found', { eventType: 'ACCOUNT', action: 'CLOSE', userId, accountId: id });
                throw new NotFoundException('Account not found');
            }
            if (account.status === AccountStatus.CLOSED) {
                this.structuredLogger.warn(AccountsService.name, 'Close skipped: already closed', { eventType: 'ACCOUNT', action: 'CLOSE', userId, accountId: id });
                throw new BadRequestException('Account is already closed');
            }
            if (!account.balance.eq(new Prisma.Decimal(0))) {
                this.structuredLogger.warn(AccountsService.name, 'Close failed: non-zero balance', { eventType: 'ACCOUNT', action: 'CLOSE', userId, accountId: id, balance: account.balance.toString() });
                throw new BadRequestException('Account balance must be zero to close account');
            }
            throw new BadRequestException('Account state changed, try again');
        }
        await this.prisma.auditLog.create({
            data: {
                action: PrismaAction.ACCOUNT_CLOSE,
                customerId: userId,
                entityType: 'ACCOUNT',
                entityId: id,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        const account = await this.prisma.account.findFirst({
            where: { id, customerId: userId },
        });
        if (!account) {
            throw new NotFoundException('Account not found');
        }
        this.structuredLogger.info(AccountsService.name, 'Account closed', { eventType: 'ACCOUNT', action: 'CLOSE', userId, accountId: id });
        return accountMapper.toResponseDto(account);
    }
}
