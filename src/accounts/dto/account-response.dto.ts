import { Currency, AccountStatus } from '../../common/enums';

export class AccountResponseDto {
    id: string;
    balance: string;
    currency: Currency;
    status: AccountStatus;
    createdAt: Date;
}