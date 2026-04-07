import { EventType } from '../../common/enums';
import {
  buildTransactionEmailContent,
  buildWelcomeEmailContent,
} from './email-content.builder';

describe('buildTransactionEmailContent', () => {
  it('builds success email content', () => {
    const content = buildTransactionEmailContent({
      customerName: 'Alice',
      eventType: EventType.TRANSACTION_COMPLETED,
      transactionType: 'DEPOSIT',
      transactionId: 'tx-1',
      amount: 25,
    });

    expect(content.subject).toBe('Transaction successful: DEPOSIT');
    expect(content.text).toContain('Hi Alice');
    expect(content.text).toContain('tx-1');
    expect(content.text).toContain('25.00');
    expect(content.text).toContain('has completed successfully');
  });

  it('builds failure email content with UNKNOWN fallback', () => {
    const content = buildTransactionEmailContent({
      customerName: 'Alice',
      eventType: EventType.TRANSACTION_FAILED,
      transactionType: 'WITHDRAW',
      transactionId: 'tx-2',
      amount: 10,
    });

    expect(content.subject).toBe('Transaction failed: WITHDRAW');
    expect(content.text).toContain('Hi Alice');
    expect(content.text).toContain('tx-2');
    expect(content.text).toContain('10.00');
    expect(content.text).toContain('reason UNKNOWN');
  });

  it('builds welcome email content for registered user', () => {
    const content = buildWelcomeEmailContent({
      customerName: 'Alice',
    });

    expect(content.subject).toBe('Welcome to Banking Backend');
    expect(content.text).toContain('Hi Alice');
    expect(content.text).toContain('welcome to Banking Backend');
  });
});
