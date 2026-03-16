import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserMeResponseDto } from './dto/user-me-response.dto';
import { userMapper } from './users.mapper';
import { UpdateUserMeRequestDto } from './dto/update-user-me-request.dto';
import { UpdatePasswordRequestDto } from './dto/update-password-request.dto';
import { UpdatePasswordResponseDto } from './dto/update-password-response.dto';
import * as bcrypt from 'bcrypt';


@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    async getMe(userId: string): Promise<UserMeResponseDto> {
        const user = await this.prisma.customer.findUnique({
            where: { id: userId },
            include: { accounts: true },
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return userMapper.toMeResponseDto(user);
    }

    async putMe(userId: string, updateUserMeRequestDto: UpdateUserMeRequestDto): Promise<UserMeResponseDto> {

        const { email, name, phone } = updateUserMeRequestDto;

        const user = await this.prisma.customer.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }
        if (email && email !== user.email) {
            const existingUser = await this.prisma.customer.findUnique({
                where: { email },
            });
            if (existingUser && existingUser.id !== userId) {
                throw new ConflictException('Email already exists');
            }
        }


        const updatedUser = await this.prisma.customer.update({
            where: { id: userId },
            data: {
                email: email ?? user?.email,
                name: name ?? user?.name,
                phone: phone ?? user?.phone,
            },
            include: { accounts: true },
        });

        return userMapper.toMeResponseDto(updatedUser);

    }

    async patchPassword(userId: string, updatePasswordRequestDto: UpdatePasswordRequestDto): Promise<UpdatePasswordResponseDto> {
        const { oldPassword, newPassword } = updatePasswordRequestDto;
        const user = await this.prisma.customer.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid old password');
        }

        if (oldPassword === newPassword) {
            throw new BadRequestException('New password cannot be the same as the old password');
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await this.prisma.customer.update({
            where: { id: userId },
            data: { passwordHash: hashedNewPassword },
        });
        return {
            message: 'Password updated successfully',
        };
    }
}
