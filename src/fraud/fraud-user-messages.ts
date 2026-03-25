import { TransactionType } from '../common/enums';

export function getFraudRejectionMessage(
  transactionType: TransactionType,
  fraudReason?: string,
): string {
  switch (fraudReason) {
    case 'SAME_ACCOUNT_TRANSFER':
      return 'You cannot transfer to the same account.';
    case 'TRANSFER_AMOUNT_EXCEEDED':
      return 'The transfer amount exceeds the allowed limit.';
    case 'TOO_MANY_TRANSFERS_IN_MINUTE':
      return 'Too many transfer attempts in a short time. Please try again later.';
    case 'DAILY_TRANSFER_LIMIT_EXCEEDED':
      return 'Your daily transfer limit has been exceeded.';
    case 'WITHDRAW_AMOUNT_EXCEEDED':
      return 'The withdrawal amount exceeds the allowed limit.';
    case 'DAILY_WITHDRAW_LIMIT_EXCEEDED':
      return 'Your daily withdrawal limit has been exceeded.';
    default:
      return transactionType === TransactionType.WITHDRAW
        ? 'Your withdrawal was rejected by our fraud checks.'
        : 'Your transaction was rejected by our fraud checks.';
  }
}

