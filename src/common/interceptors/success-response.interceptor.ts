import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { map, Observable, tap } from 'rxjs';

@Injectable()
export class SuccessResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SuccessResponseInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<{ method: string; url: string; traceId?: string }>();
    const { method, url, traceId } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startedAt;
        const trace = traceId ?? 'no-trace-id';
        this.logger.log(`[${trace}] ${method} ${url} -> 200 (${durationMs}ms)`);
      }),
      map((data) => ({
        success: true,
        data,
        meta: {},
        timestamp: new Date().toISOString(),
        path: url,
      })),
    );
  }
}