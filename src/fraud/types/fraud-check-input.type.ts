import { Prisma } from "src/generated/prisma/client";

export type FraudCheckInput = {
userId: string;
fromAccountId: string;
toAccountId: string;
amount: Prisma.Decimal;
}
