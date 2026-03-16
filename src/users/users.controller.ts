import { Controller, UseGuards, Get, Put, Body, Patch} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserMeResponseDto } from './dto/user-me-response.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UpdateUserMeRequestDto } from './dto/update-user-me-request.dto';
import { UpdatePasswordRequestDto } from './dto/update-password-request.dto';

@Controller('users')
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: CurrentUserPayload): Promise<UserMeResponseDto> {
    return this.usersService.getMe(user.userId);
  }
  @Put('me')
  async putMe(@CurrentUser() user: CurrentUserPayload, @Body() updateUserMeRequestDto: UpdateUserMeRequestDto): Promise<UserMeResponseDto> {
    return this.usersService.putMe(user.userId, updateUserMeRequestDto);
  }
  
@Patch('me/password')
  async patchPassword(@CurrentUser() user: CurrentUserPayload, @Body() updatePasswordRequestDto: UpdatePasswordRequestDto): Promise<{ message: string }> {
    return this.usersService.patchPassword(user.userId, updatePasswordRequestDto);
  }

}
