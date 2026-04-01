import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '../request-context/request-context';
import { getClientIpMasked, getUserAgent } from '../http/client-context';
import { StructuredLogger } from '../../logger/structured-logger.service';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  constructor(private readonly structuredLogger: StructuredLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const traceId = uuidv4();
    (req as Request & { traceId: string }).traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    const requestPath = req.originalUrl || req.url;
  
    const clientIpMasked = getClientIpMasked(req);
    const userAgent = getUserAgent(req);
  
    this.structuredLogger.info('TraceIdMiddleware', 'Incoming request', {
      eventType: 'HTTP',
      action: 'REQUEST_RECEIVED',
      method: req.method,
      path: requestPath,
      traceId,
    });
  
    res.on('finish', () => {
      this.structuredLogger.info('TraceIdMiddleware', 'Response completed', {
        eventType: 'HTTP',
        action: 'RESPONSE_SENT',
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        traceId,
      });
    });
  
    RequestContext.run(
      { clientIpMasked, userAgent, traceId, requestId: traceId },
      () => {
        next();
      },
    );
  }
}