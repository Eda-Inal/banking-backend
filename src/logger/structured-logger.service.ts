import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';
import { RequestContext } from '../common/request-context/request-context';

type ContextHints = {
  requestId?: string;
  traceId?: string;
  userId?: string;
};

@Injectable()
export class StructuredLogger {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  info(context: string, message: string, details?: Record<string, unknown>): void {
    this.winston.info({
      message,
      context,
      ...(details ? { details } : {}),
      ...this.contextHints(),
    });
  }

  warn(context: string, message: string, details?: Record<string, unknown>): void {
    this.winston.warn({
      message,
      context,
      ...(details ? { details } : {}),
      ...this.contextHints(),
    });
  }

  debug(context: string, message: string, details?: Record<string, unknown>): void {
    this.winston.debug({
      message,
      context,
      ...(details ? { details } : {}),
      ...this.contextHints(),
    });
  }

  error(
    context: string,
    message: string,
    options?: {
      error?: Error | { message: string; stack?: string; code?: string };
      details?: Record<string, unknown>;
    },
  ): void {
    const { error: errOpt, details } = options ?? {};
    this.winston.log({
      level: 'error',
      message,
      context,
      ...this.contextHints(),
      ...(details ? { details } : {}),
      ...(errOpt instanceof Error ? { error: errOpt } : errOpt ? { error: errOpt } : {}),
    });
  }

  private contextHints(): ContextHints {
    const ctx = RequestContext.get();
    const hints: ContextHints = {};
    const rid = ctx.requestId ?? ctx.traceId;
    if (rid) hints.requestId = rid;
    if (ctx.traceId) hints.traceId = ctx.traceId;
    if (ctx.userId) hints.userId = ctx.userId;
    return hints;
  }
}
