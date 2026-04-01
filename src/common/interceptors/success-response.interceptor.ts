import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable, tap } from 'rxjs';
import { StructuredLogger } from '../../logger/structured-logger.service';

@Injectable()
export class SuccessResponseInterceptor implements NestInterceptor {
  constructor(private readonly structuredLogger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; url: string; originalUrl?: string }>();
    const response = http.getResponse<{ statusCode: number }>();
    const { method, url } = request;
    const requestPath = request.originalUrl || url;
    const startedAt = Date.now();

    if (url === '/metrics' || url.startsWith('/metrics?')) {
      return next.handle().pipe(
        tap(() => {
          const durationMs = Date.now() - startedAt;
          this.structuredLogger.info(SuccessResponseInterceptor.name, 'HTTP success response', {
            eventType: 'HTTP',
            action: 'REQUEST_SUCCESS',
            method,
            path: requestPath,
            statusCode: response.statusCode,
            durationMs,
          });
        }),
      );
    }

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startedAt;
        this.structuredLogger.info(SuccessResponseInterceptor.name, 'HTTP success response', {
          eventType: 'HTTP',
          action: 'REQUEST_SUCCESS',
          method,
          path: requestPath,
          statusCode: response.statusCode,
          durationMs,
        });
      }),
      map((data) => ({
        success: true,
        data,
        meta: {},
        timestamp: new Date().toISOString(),
        path: requestPath,
      })),
    );
  }
}