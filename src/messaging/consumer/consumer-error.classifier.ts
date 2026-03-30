import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
  PrismaClientUnknownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/client';
import {
  PermanentConsumerError,
  TransientConsumerError,
} from './consumer.errors';


const TRANSIENT_PRISMA_KNOWN_CODES = new Set<string>([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2034',
]);

const TRANSIENT_NODE_ERRNO_CODES = new Set<string>([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function errnoCode(err: Error): string | undefined {
  const c = (err as NodeJS.ErrnoException).code;
  return typeof c === 'string' ? c : undefined;
}

function classifyPrismaError(error: unknown): boolean | undefined {
  if (error instanceof PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_KNOWN_CODES.has(error.code);
  }
  if (error instanceof PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof PrismaClientValidationError) {
    return false;
  }
  if (error instanceof PrismaClientRustPanicError) {
    return false;
  }
  if (error instanceof PrismaClientUnknownRequestError) {
    return true;
  }
  return undefined;
}

function classifyNodeOrNetworkError(error: Error): boolean | undefined {
  const code = errnoCode(error);
  if (code && TRANSIENT_NODE_ERRNO_CODES.has(code)) {
    return true;
  }
  return undefined;
}

function fallbackMessageLooksTransient(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout')
  );
}

function classifyErrorInstance(error: Error): boolean | undefined {
  const prisma = classifyPrismaError(error);
  if (prisma !== undefined) return prisma;

  const node = classifyNodeOrNetworkError(error);
  if (node !== undefined) return node;

  return undefined;
}

function walkErrorCauses(error: unknown, maxDepth: number): boolean | undefined {
  let current: unknown = error;
  for (let d = 0; d < maxDepth && current instanceof Error; d++) {
    const decision = classifyErrorInstance(current);
    if (decision !== undefined) return decision;
    current = current.cause;
  }
  return undefined;
}

function walkAggregateErrors(error: unknown): boolean | undefined {
  if (!(error instanceof AggregateError)) return undefined;
  for (const sub of error.errors) {
    const fromChain = walkErrorCauses(sub, 8);
    if (fromChain !== undefined) return fromChain;
  }
  return undefined;
}

export function isTransientConsumerError(error: unknown): boolean {
  if (error instanceof TransientConsumerError) return true;
  if (error instanceof PermanentConsumerError) return false;

  const agg = walkAggregateErrors(error);
  if (agg !== undefined) return agg;

  const fromChain = walkErrorCauses(error, 8);
  if (fromChain !== undefined) return fromChain;

  if (error instanceof Error && fallbackMessageLooksTransient(error)) {
    return true;
  }

  return false;
}
