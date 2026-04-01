import { format } from 'winston';
import { RequestContext } from '../common/request-context/request-context';
import type { LogWithDetails, StructuredLogLevel } from './structured-log.types';
import { BANKING_LOG_SERVICE_NAME } from './log-constants';

function mapWinstonLevel(level: string): StructuredLogLevel {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warn';
  if (level === 'debug' || level === 'verbose' || level === 'silly') return 'debug';
  return 'info';
}

function normalizeTimestamp(ts: unknown): string {
  if (typeof ts === 'string' && ts.includes('T')) return ts;
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function normalizeMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message == null) return '';
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

function normalizeContext(ctx: unknown): string {
  if (typeof ctx === 'string' && ctx) return ctx;
  if (ctx != null) return String(ctx);
  return 'Application';
}

function stackToString(stack: unknown): string | undefined {
  if (stack == null) return undefined;
  if (Array.isArray(stack)) {
    const s = stack.filter(Boolean).join('\n');
    return s || undefined;
  }
  if (typeof stack === 'string') return stack || undefined;
  return String(stack);
}

export function bankingStructuredLogFormat() {
  return format.printf((info): string => {
    const ctx = RequestContext.get();
    const message = normalizeMessage(info.message);
    const contextStr = normalizeContext(info.context);

    const record: LogWithDetails = {
      timestamp: normalizeTimestamp(info.timestamp),
      level: mapWinstonLevel(info.level),
      service: BANKING_LOG_SERVICE_NAME,
      context: contextStr,
      message,
    };

    const requestId =
      (typeof info.requestId === 'string' && info.requestId) ||
      ctx.requestId ||
      ctx.traceId;
    const traceId = (typeof info.traceId === 'string' && info.traceId) || ctx.traceId;
    const userId = (typeof info.userId === 'string' && info.userId) || ctx.userId;

    if (requestId) record.requestId = requestId;
    if (traceId) record.traceId = traceId;
    if (userId) record.userId = userId;

    if (info.details !== undefined && info.details !== null) {
      record.details =
        typeof info.details === 'object' && !Array.isArray(info.details)
          ? (info.details as Record<string, unknown>)
          : { value: info.details as unknown };
    }

    const errUnknown = info.error;
    if (errUnknown instanceof Error) {
      record.error = {
        message: errUnknown.message,
        stack: errUnknown.stack,
        code: (errUnknown as NodeJS.ErrnoException & { code?: string }).code,
      };
    } else if (errUnknown && typeof errUnknown === 'object' && !Array.isArray(errUnknown)) {
      const e = errUnknown as Record<string, unknown>;
      record.error = {
        message: typeof e.message === 'string' ? e.message : message,
        stack: typeof e.stack === 'string' ? e.stack : stackToString(e.stack),
        code: typeof e.code === 'string' ? e.code : undefined,
      };
    } else if (info.level === 'error') {
      const stackStr = stackToString(info.stack);
      if (stackStr) {
        record.error = { message, stack: stackStr };
      }
    }

    return JSON.stringify(record);
  });
}
