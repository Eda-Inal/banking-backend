import { Prisma } from "src/generated/prisma/client";

export type TransferFraudCheckInput = {
    scope: 'TRANSFER';
    userId: string;
    referenceId: string;
    fromAccountId: string;
    toAccountId: string;
    amount: Prisma.Decimal;
}
