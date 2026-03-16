import { AccountSummaryDto } from '../../account/dto/account-summary.dto';

export class UserMeResponseDto {
    id: string;
    email: string;
    name: string;
    phone: string;
    accounts: AccountSummaryDto[];
}