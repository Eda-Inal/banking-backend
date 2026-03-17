import { TransactionType, TransactionStatus } from '../../common/enums';

export class TransactionResponseDto {
    id: string;
    type: TransactionType;
    fromAccountId: string | null;
    toAccountId: string | null;
    amount: string;
    status: TransactionStatus;
    referenceId: string;
    createdAt: Date;
}