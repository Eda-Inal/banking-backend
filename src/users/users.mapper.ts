import { UserMeResponseDto } from './dto/user-me-response.dto';
import type { Account, Customer } from '../generated/prisma/client';
import { accountMapper } from '../account/accounts.mapper';

export const userMapper = {
  toMeResponseDto(user: Customer & { accounts: Account[] }): UserMeResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      accounts: user.accounts.map(accountMapper.toSummaryDto),
    };
  },
};
