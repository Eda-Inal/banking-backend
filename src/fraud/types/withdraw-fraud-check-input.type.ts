import { Prisma } from "src/generated/prisma/client";

export type WithdrawFraudCheckInput = {
    scope: 'WITHDRAW';
    userId: string;
    referenceId: string;
    fromAccountId: string;
    amount: Prisma.Decimal;
}