import { Controller, UseGuards, Get } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserMeResponseDto } from './dto/user-me-response.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: CurrentUserPayload): Promise<UserMeResponseDto> {
    return this.usersService.getMe(user.userId);
  }
}
