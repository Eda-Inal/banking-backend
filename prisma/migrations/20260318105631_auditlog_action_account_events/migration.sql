-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Action" ADD VALUE 'ACCOUNT_CREATE';
ALTER TYPE "Action" ADD VALUE 'ACCOUNT_FREEZE';
ALTER TYPE "Action" ADD VALUE 'ACCOUNT_UNFREEZE';
ALTER TYPE "Action" ADD VALUE 'ACCOUNT_CLOSE';
ALTER TYPE "Action" ADD VALUE 'PASSWORD_CHANGE';
ALTER TYPE "Action" ADD VALUE 'REGISTER';
ALTER TYPE "Action" ADD VALUE 'REFRESH';
