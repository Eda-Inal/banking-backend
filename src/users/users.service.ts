import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserMeResponseDto } from './dto/user-me-response.dto';
import { userMapper } from './users.mapper';
import { UpdateUserMeRequestDto } from './dto/update-user-me-request.dto';
import { UpdatePasswordRequestDto } from './dto/update-password-request.dto';
import { UpdatePasswordResponseDto } from './dto/update-password-response.dto';
import * as bcrypt from 'bcrypt';
import { RequestContext } from '../common/request-context/request-context';
import { Action as AuditAction } from '../common/enums';
import { AuditService } from '../audit/audit.service';


@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) { }

    async getMe(userId: string): Promise<UserMeResponseDto> {
        const user = await this.prisma.customer.findUnique({
            where: { id: userId },
            include: { accounts: true },
        });
        if (!user) {
            this.logger.warn(`getMe: user not found for id ${userId}`);
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
            this.logger.warn(`putMe: user not found for id ${userId}`);
            throw new NotFoundException('User not found');
        }

        let updatedUser;
        try {
            updatedUser = await this.prisma.customer.update({
                where: { id: userId },
                data: {
                    email: email ?? user?.email,
                    name: name ?? user?.name,
                    phone: phone ?? user?.phone,
                },
                include: { accounts: true },
            });
        } catch (err) {
            const isP2002 =
                err instanceof Error &&
                'code' in err &&
                (err as { code?: string }).code === 'P2002';
            if (isP2002) {
                this.logger.warn(`putMe: unique conflict for email ${email ?? '(unchanged)'} (user ${userId})`);
                throw new ConflictException('Email already exists');
            }
            throw err;
        }

        this.logger.log(
            `User profile updated: ${updatedUser.id} (${updatedUser.email}) - fields: ${[
                email ? 'email' : null,
                name ? 'name' : null,
                phone ? 'phone' : null,
            ]
                .filter(Boolean)
                .join(', ') || 'none'}`,
        );

        return userMapper.toMeResponseDto(updatedUser);

    }

    async patchPassword(userId: string, updatePasswordRequestDto: UpdatePasswordRequestDto): Promise<UpdatePasswordResponseDto> {
        const { oldPassword, newPassword } = updatePasswordRequestDto;
        const { clientIpMasked, userAgent } = RequestContext.get();
        const user = await this.prisma.customer.findUnique({
            where: { id: userId },
        });
        if (!user) {
            this.logger.warn(`patchPassword: user not found for id ${userId}`);
            throw new NotFoundException('User not found');
        }

        const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!isPasswordValid) {
            this.logger.warn(`patchPassword: invalid old password for user ${user.id} (${user.email})`);
            throw new UnauthorizedException('Invalid old password');
        }

        if (oldPassword === newPassword) {
            throw new BadRequestException('New password cannot be the same as the old password');
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await this.prisma.$transaction(async (tx) => {
            await tx.customer.update({
                where: { id: userId },
                data: { passwordHash: hashedNewPassword },
            });
            await tx.refreshToken.updateMany({
                where: {
                    customerId: userId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: new Date(),
                },
            });
        });

        await this.audit.recordSuccess({
            action: AuditAction.PASSWORD_CHANGE,
            outcome: undefined,
            customerId: userId,
            entityType: 'CUSTOMER',
            entityId: userId,
            traceId: undefined,
            ipAddress: clientIpMasked,
            userAgent,
        });
        this.logger.log(`Password changed for user ${user.id} (${user.email})`);
        return {
            message: 'Password updated successfully',
        };
    }
}
