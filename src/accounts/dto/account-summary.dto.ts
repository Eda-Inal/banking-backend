import { Currency, AccountStatus } from '../../common/enums';

export class AccountSummaryDto {
    id: string;
    balance: string;
    currency: Currency;
    status: AccountStatus;
}