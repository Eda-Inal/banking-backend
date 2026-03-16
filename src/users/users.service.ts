import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserMeResponseDto } from './dto/user-me-response.dto';
import { userMapper } from './users.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
