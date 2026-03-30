import type { TransactionEventPayload } from '../../common/transaction-event.contract';
import { TransactionType } from '../../common/enums';
import { PermanentConsumerError } from './consumer.errors';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidTransactionType(v: unknown): v is TransactionType {
  return (
    typeof v === 'string' &&
    Object.values(TransactionType).includes(v as TransactionType)
  );
}

export function validateTransactionEventPayload(
  payload: unknown,
): TransactionEventPayload {
  if (!payload || typeof payload !== 'object') {
    throw new PermanentConsumerError('invalid transaction payload: not an object');
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.actorId)) {
    throw new PermanentConsumerError('invalid transaction payload: actorId');
  }
  if (!isNonEmptyString(p.resourceId)) {
    throw new PermanentConsumerError('invalid transaction payload: resourceId');
  }
  if (!isNonEmptyString(p.traceId)) {
    throw new PermanentConsumerError('invalid transaction payload: traceId');
  }
  if (p.outcome !== 'SUCCESS' && p.outcome !== 'FAILURE') {
    throw new PermanentConsumerError('invalid transaction payload: outcome');
  }

  if (
    p.reasonCode !== undefined &&
    p.reasonCode !== null &&
    !isNonEmptyString(p.reasonCode)
  ) {
    throw new PermanentConsumerError('invalid transaction payload: reasonCode');
  }

  const m = p.metadata;
  if (!m || typeof m !== 'object') {
    throw new PermanentConsumerError('invalid transaction payload: metadata');
  }
  const meta = m as Record<string, unknown>;

  if (!isValidTransactionType(meta.transactionType)) {
    throw new PermanentConsumerError(
      'invalid transaction payload: metadata.transactionType',
    );
  }
  if (!isNonEmptyString(meta.referenceId)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.referenceId');
  }
  if (typeof meta.amount !== 'number' || !Number.isFinite(meta.amount)) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.amount');
  }

  const fromOk =
    meta.fromAccountId === null ||
    meta.fromAccountId === undefined ||
    isNonEmptyString(meta.fromAccountId);
  const toOk =
    meta.toAccountId === null ||
    meta.toAccountId === undefined ||
    isNonEmptyString(meta.toAccountId);

  if (!fromOk || !toOk) {
    throw new PermanentConsumerError('invalid transaction payload: metadata account ids');
  }

  if (
    meta.fraudRule !== undefined &&
    meta.fraudRule !== null &&
    !isNonEmptyString(meta.fraudRule)
  ) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.fraudRule');
  }

  if (
    meta.clientIpMasked !== undefined &&
    meta.clientIpMasked !== null &&
    !isNonEmptyString(meta.clientIpMasked)
  ) {
    throw new PermanentConsumerError(
      'invalid transaction payload: metadata.clientIpMasked',
    );
  }
  if (
    meta.userAgent !== undefined &&
    meta.userAgent !== null &&
    !isNonEmptyString(meta.userAgent)
  ) {
    throw new PermanentConsumerError('invalid transaction payload: metadata.userAgent');
  }

  return p as unknown as TransactionEventPayload;
}
