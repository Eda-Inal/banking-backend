import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('TraceId');

  use(req: Request, res: Response, next: NextFunction) {
    const traceId = uuidv4();
    (req as Request & { traceId: string }).traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);

    this.logger.log(`[${traceId}] Incoming request: ${req.method} ${req.url}`);

    res.on('finish', () => {
      this.logger.log(`[${traceId}] Response status: ${res.statusCode}`);
    });

    next();
  }
}