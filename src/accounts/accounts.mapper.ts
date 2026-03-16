import { AccountSummaryDto } from './dto/account-summary.dto';
import { Currency, AccountStatus } from '../common/enums';
import type { Account } from '../generated/prisma/client';
import { AccountResponseDto } from './dto/account-response.dto';

export const accountMapper = {
  toSummaryDto(account: Account): AccountSummaryDto {
    if (!Object.values(Currency).includes(account.currency as Currency)) {
      throw new Error(`Invalid currency: ${account.currency}`);
    }
    if (!Object.values(AccountStatus).includes(account.status as AccountStatus)) {
      throw new Error(`Invalid status: ${account.status}`);
    }
    return {
      id: account.id,
      balance: account.balance.toString(),
      currency: account.currency as Currency,
      status: account.status as AccountStatus,
    };
  },

  toResponseDto(account: Account): AccountResponseDto {

    return {
      id: account.id,
      balance: account.balance.toString(),
      currency: account.currency as Currency,
      status: account.status as AccountStatus,
      createdAt: account.createdAt,
    };
  },
};