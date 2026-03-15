import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
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

interface LoginWithRefresh extends LoginResponseDto {
    refreshToken: string;
}

interface RefreshResult extends LoginResponseDto {
    refreshToken: string;
}

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService, private readonly jwtService: JwtService, private readonly config: ConfigService) { }

    async register(registerRequestDto: RegisterRequestDto): Promise<RegisterResponseDto> {

        const { email, password, name, phone } = registerRequestDto;

        const customer = await this.prisma.customer.findUnique({
            where: {
                email,
            },
        });

        if (customer) {
            throw new ConflictException('Customer already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await this.prisma.customer.create({
            data: {
                email,
                passwordHash: hashedPassword,
                name,
                phone,
            },
        })

        return {
            message: 'Customer registered successfully',
        };


    }

    async login(loginRequestDto: LoginRequestDto): Promise<LoginWithRefresh> {

        const { email, password } = loginRequestDto;

        let customer = await this.prisma.customer.findUnique({
            where: {
                email,
            },
        });

        if (!customer) {
            throw new UnauthorizedException('Invalid credentials');
        }
        const now = new Date();
        if (customer.lockUntil && customer.lockUntil > now) {
            throw new AccountLockedException('Account temporarily locked due to too many failed attempts. Try again later.');
        }
        if (customer.lockUntil != null && customer.lockUntil <= now) {
            customer = await this.prisma.customer.update({
                where: { id: customer.id },
                data: { failedLoginAttempts: 0, lockUntil: null },
            });
        }
        const threshold = Number(this.config.get(CONFIG_KEYS.LOGIN_LOCK_THRESHOLD)) || 5;
        const durationMinutes = Number(this.config.get(CONFIG_KEYS.LOGIN_LOCK_DURATION_MINUTES)) || 15;
        const delayCapSeconds = Number(this.config.get(CONFIG_KEYS.LOGIN_DELAY_CAP_SECONDS)) || 30;


        const isPasswordValid = await bcrypt.compare(password, customer.passwordHash);
        if (!isPasswordValid) {
            const rows = await this.prisma.$queryRaw<
                { failed_login_attempts: number; lock_until: Date | null }[]
            >(
                Prisma.sql`
                    UPDATE customers
                    SET
                        failed_login_attempts = failed_login_attempts + 1,
                        lock_until = CASE
                            WHEN failed_login_attempts + 1 >= ${threshold} THEN NOW() + (${durationMinutes} * interval '1 minute')
                            ELSE lock_until
                        END
                    WHERE id = ${customer.id}
                    RETURNING failed_login_attempts, lock_until
                `,
            );

            const updated = rows[0];
            if (!updated) throw new UnauthorizedException('Invalid credentials');

            const newAttempts = updated.failed_login_attempts;

            const delaySeconds = Math.min(delayCapSeconds, Math.pow(2, newAttempts));
            await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

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

        await this.prisma.refreshToken.create({
            data: {
                customerId: customer.id,
                tokenHash: refreshTokenHash,
                expiresAt,
            },
        });

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

        const rawRefreshToken = req.cookies.refreshToken;
        if (!rawRefreshToken) {
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
            throw new UnauthorizedException('Invalid refresh token');
        }
        if (refreshTokenRecord.revokedAt) {
            throw new UnauthorizedException('Refresh token revoked');
        }
        if (refreshTokenRecord.expiresAt < new Date()) {
            throw new UnauthorizedException('Refresh token expired');
        }
        if (refreshTokenRecord.replacedById) {
            throw new UnauthorizedException('Refresh token already used');
        }
        const customer = refreshTokenRecord.customer;
        if (!customer) {
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

        const newTokenRecord = await this.prisma.refreshToken.create({
            data: {
                customerId: customer.id,
                tokenHash: newTokenHash,
                expiresAt: newExpiresAt,
            },
        });

        await this.prisma.refreshToken.update({
            where: { id: refreshTokenRecord.id },
            data: {
                revokedAt: new Date(),
                replacedById: newTokenRecord.id,
            },
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
        }

        return { message: 'Logged out' };
    }
}
