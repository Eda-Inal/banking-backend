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

        const customer = await this.prisma.customer.findUnique({
            where: {
                email,
            },
        });

        if (!customer) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(password, customer.passwordHash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

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

        const user = {
            id: customer.id,
            email: customer.email,
            name: customer.name,
        }
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

        const refreshTokenRecord = await this.prisma.refreshToken.findFirst({
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
        
        const user = {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        };
        
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

        const refreshTokenRecord = await this.prisma.refreshToken.findFirst({
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
