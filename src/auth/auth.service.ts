import { Injectable, ConflictException, UnauthorizedException,Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { CONFIG_KEYS } from '../config/config';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { v4 as uuid } from 'uuid';
import { JwtPayload } from './jwt-payload.interface';
import * as crypto from 'crypto';
import { AccountLockedException } from './exceptions/account-locked.exception';
import { Prisma } from '../generated/prisma/client';
import { Action as AuditAction } from '../common/enums';
import { RequestContext } from '../common/request-context/request-context';
import { AuditService } from '../audit/audit.service';

interface LoginWithRefresh extends LoginResponseDto {
    refreshToken: string;
}

interface RefreshResult extends LoginResponseDto {
    refreshToken: string;
}

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly config: ConfigService,
        private readonly audit: AuditService,
    ) { }

    async register(registerRequestDto: RegisterRequestDto): Promise<RegisterResponseDto> {

        const { email, password, name, phone } = registerRequestDto;
        const { clientIpMasked, userAgent } = RequestContext.get();

        const customer = await this.prisma.customer.findUnique({
            where: {
                email,
            },
        });

        if (customer) {
            this.logger.warn(`Register attempt with existing email: ${email}`);
            throw new ConflictException('Customer already exists');
        }


        const hashedPassword = await bcrypt.hash(password, 10);
        let registeredCustomer;
        try {
            registeredCustomer = await this.prisma.customer.create({
                data: {
                    email,
                    passwordHash: hashedPassword,
                    name,
                    phone,
                },
            });
        } catch (err) {
            const isP2002 =
                err instanceof Error &&
                'code' in err &&
                (err as { code?: string }).code === 'P2002';
            if (isP2002) {
                this.logger.warn(`Register unique conflict for email: ${email}`);
                throw new ConflictException('Customer already exists');
            }
            throw err;
        }
        await this.audit.recordSuccess({
            action: AuditAction.REGISTER,
            customerId: registeredCustomer.id,
            entityType: 'CUSTOMER',
            entityId: registeredCustomer.id,
            ipAddress: clientIpMasked,
            userAgent,
        });

        this.logger.log(`User registered: ${registeredCustomer.id} (${registeredCustomer.email})`);

        return {
            message: 'Customer registered successfully',
        };


    }

    async login(loginRequestDto: LoginRequestDto): Promise<LoginWithRefresh> {

        const { email, password } = loginRequestDto;
        const { clientIpMasked, userAgent } = RequestContext.get();

        let customer = await this.prisma.customer.findUnique({
            where: {
                email,
            },
        });

        if (!customer) {
            this.logger.warn(`Login attempt with invalid email: ${email}`);
         
            throw new UnauthorizedException('Invalid credentials');
        }
        const now = new Date();
        if (customer.lockUntil && customer.lockUntil > now) {
            throw new AccountLockedException('Account temporarily locked due to too many failed attempts. Try again later.');
        }
        const threshold = Number(this.config.get(CONFIG_KEYS.LOGIN_LOCK_THRESHOLD)) || 5;
        const durationMinutes = Number(this.config.get(CONFIG_KEYS.LOGIN_LOCK_DURATION_MINUTES)) || 15;


        const isPasswordValid = await bcrypt.compare(password, customer.passwordHash);
        if (!isPasswordValid) {
            this.logger.warn(`Login failed: invalid password for user ${customer.id} (${customer.email})`);
            const rows = await this.prisma.$queryRaw<
                { failed_login_attempts: number; lock_until: Date | null }[]
            >(
                Prisma.sql`
                    UPDATE customers
                    SET
                        failed_login_attempts = failed_login_attempts + 1,
                        lock_until = CASE
                            WHEN failed_login_attempts + 1 >= ${threshold} THEN NOW() + (${durationMinutes} * interval '1 minute')
                            ELSE NULL
                        END
                    WHERE id = ${customer.id}
                    RETURNING failed_login_attempts, lock_until
                `,
            );

            const updated = rows[0];
            if (!updated) {
                throw new UnauthorizedException('Invalid credentials');
            }

            if (updated.lock_until) {
                this.logger.warn(
                    `Account locked due to failed attempts: ${customer.id} (${customer.email}) until ${updated.lock_until}`,
                );
            }
            await this.audit.recordFailure({
                action: AuditAction.LOGIN,
                customerId: customer.id,
                entityType: 'CUSTOMER',
                entityId: customer.id,
                reasonCode: 'INVALID_CREDENTIALS',
                ipAddress: clientIpMasked,
                userAgent,
            });

            throw new UnauthorizedException('Invalid credentials');
        }

        await this.prisma.customer.update({
            where: { id: customer.id },
            data: { failedLoginAttempts: 0, lockUntil: null },
        });


        const accessPayload: JwtPayload = {
            sub: customer.id
        }
        const accessToken = await this.jwtService.signAsync(accessPayload);

        const rawRefreshToken = crypto.randomBytes(64).toString('hex');

        const refreshTokenHash = crypto
            .createHash('sha256')
            .update(rawRefreshToken)
            .digest('hex');

        const refreshTtlSeconds = Number(
            this.config.get(CONFIG_KEYS.JWT_REFRESH_EXPIRES_IN),
        );
        const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

        await this.prisma.refreshToken.updateMany({
            where: {
                customerId: customer.id,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        await this.prisma.refreshToken.create({
            data: {
                customerId: customer.id,
                tokenHash: refreshTokenHash,
                expiresAt,
                ipAddress: clientIpMasked,
                userAgent,
            },
        });
        await this.audit.recordSuccess({
            action: AuditAction.LOGIN,
            customerId: customer.id,
            entityType: 'CUSTOMER',
            entityId: customer.id,
            ipAddress: clientIpMasked,
            userAgent,
        });
        this.logger.log(`Login successful: ${customer.id} (${customer.email})`);

        const { id, name } = customer;
        const user = { id, email, name };

        const expiresIn =
            Number(this.config.get(CONFIG_KEYS.JWT_ACCESS_EXPIRES_IN)) || 900;
        return {
            accessToken: accessToken,
            refreshToken: rawRefreshToken,
            expiresIn,
            tokenType: 'Bearer',
            user: user,
        }
    }

    async refresh(req: Request): Promise<RefreshResult> {
        const { clientIpMasked, userAgent } = RequestContext.get();

        const rawRefreshToken = req.cookies.refreshToken;
        if (!rawRefreshToken) {
            this.logger.warn('Refresh failed: refresh token cookie missing');
            throw new UnauthorizedException('Refresh token is required');
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(rawRefreshToken)
            .digest('hex');



        const refreshTokenRecord = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: {
                customer: true,
            },
        });
        if (!refreshTokenRecord) {
            this.logger.warn('Refresh failed: token hash not found');
            throw new UnauthorizedException('Invalid refresh token');
        }
        const customer = refreshTokenRecord.customer;
        if (!customer) {
            this.logger.warn(
                `Refresh failed: token record without customer (id: ${refreshTokenRecord.id})`,
            );
            throw new UnauthorizedException('Invalid refresh token');
        }

        const newRawRefreshToken = crypto.randomBytes(64).toString('hex');
        const newTokenHash = crypto
            .createHash('sha256')
            .update(newRawRefreshToken)
            .digest('hex');

        const refreshTtlSeconds = Number(
            this.config.get(CONFIG_KEYS.JWT_REFRESH_EXPIRES_IN),
        );
        const newExpiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

        await this.prisma.$transaction(async (tx) => {
            const newTokenRecord = await tx.refreshToken.create({
                data: {
                    customerId: customer.id,
                    tokenHash: newTokenHash,
                    expiresAt: newExpiresAt,
                    ipAddress: clientIpMasked,
                    userAgent,
                },
            });

            const revoked = await tx.refreshToken.updateMany({
                where: {
                    id: refreshTokenRecord.id,
                    revokedAt: null,
                    replacedById: null,
                    expiresAt: { gt: new Date() },
                },
                data: {
                    revokedAt: new Date(),
                    replacedById: newTokenRecord.id,
                },
            });

            if (revoked.count !== 1) {
                throw new UnauthorizedException('Refresh token already used');
            }
        });

        this.logger.log(`Refresh token rotated for user ${customer.id} (${customer.email})`);
        await this.audit.recordSuccess({
            action: AuditAction.REFRESH,
            customerId: customer.id,
            entityType: 'CUSTOMER',
            entityId: customer.id,
            ipAddress: clientIpMasked,
            userAgent,
        });

        const accessPayload: JwtPayload = { sub: customer.id };
        const accessToken = await this.jwtService.signAsync(accessPayload);

        const expiresIn =
            Number(this.config.get(CONFIG_KEYS.JWT_ACCESS_EXPIRES_IN)) || 900;

       const {id, email, name} = customer;
       const user = {id, email, name};

        return {
            accessToken,
            refreshToken: newRawRefreshToken,
            expiresIn,
            tokenType: 'Bearer',
            user,
        };
    }

    async logout(req: Request): Promise<{ message: string }> {
        const { clientIpMasked, userAgent } = RequestContext.get();
        const rawRefreshToken = req.cookies?.refreshToken;
        if (!rawRefreshToken) {
            return { message: 'Logged out' };
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(rawRefreshToken)
            .digest('hex');

        const refreshTokenRecord = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
        });
        if (refreshTokenRecord && !refreshTokenRecord.revokedAt) {
            await this.prisma.refreshToken.update({
                where: { id: refreshTokenRecord.id },
                data: { revokedAt: new Date() },
            });
            await this.audit.recordSuccess({
                action: AuditAction.LOGOUT,
                customerId: refreshTokenRecord.customerId,
                entityType: 'CUSTOMER',
                entityId: refreshTokenRecord.customerId,
                ipAddress: clientIpMasked,
                userAgent,
            });
        }

        return { message: 'Logged out' };
    }
}
