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

    async login(loginRequestDto: LoginRequestDto): Promise<LoginResponseDto> {

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

        const payload = {
            sub: customer.id,
        }
        const accessToken = await this.jwtService.signAsync(payload);

        const refreshToken = await this.jwtService.signAsync(payload, {
            expiresIn: Number(this.config.get(CONFIG_KEYS.JWT_REFRESH_EXPIRES_IN)),
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
            refreshToken: refreshToken,
            expiresIn,
            tokenType: 'Bearer',
            user: user,
        }
    }
}
