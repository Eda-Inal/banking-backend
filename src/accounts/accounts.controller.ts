import { Controller, Get, UseGuards, Param} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AccountResponseDto } from './dto/account-response.dto';



@Controller('accounts')
@UseGuards(JwtGuard)
export class AccountsController {
    constructor(private readonly accountsService: AccountsService) {}

    @Get()
    async getAccounts(@CurrentUser() user: CurrentUserPayload): Promise<AccountResponseDto[]> {
        return this.accountsService.getAccounts(user.userId);
    }

    @Get(':id')
    async getAccount(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string): Promise<AccountResponseDto> {
        return this.accountsService.getAccountById(user.userId, id);
    }

}
