import { EventType } from '../../common/enums';

export type TransactionEmailContentInput = {
  customerName: string;
  eventType: EventType.TRANSACTION_COMPLETED | EventType.TRANSACTION_FAILED;
  transactionType: string;
  transactionId: string;
  amount: number;
  reasonCode?: string;
};

export function buildTransactionEmailContent(
  input: TransactionEmailContentInput,
): { subject: string; text: string } {
  const amount = input.amount.toFixed(2);
  if (input.eventType === EventType.TRANSACTION_COMPLETED) {
    return {
      subject: `Transaction successful: ${input.transactionType}`,
      text: `Hi ${input.customerName}, your ${input.transactionType} transaction (${input.transactionId}) for ${amount} has completed successfully.`,
    };
  }

  return {
    subject: `Transaction failed: ${input.transactionType}`,
    text: `Hi ${input.customerName}, your ${input.transactionType} transaction (${input.transactionId}) for ${amount} failed with reason ${input.reasonCode ?? 'UNKNOWN'}.`,
  };
}

export function buildWelcomeEmailContent(input: {
  customerName: string;
}): { subject: string; text: string } {
  return {
    subject: 'Welcome to Banking Backend',
    text: `Hi ${input.customerName}, welcome to Banking Backend. Your account registration is complete.`,
  };
}
