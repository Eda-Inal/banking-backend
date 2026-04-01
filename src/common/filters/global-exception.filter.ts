import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { StructuredLogger } from '../../logger/structured-logger.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly structuredLogger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method: string; url: string }>();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        error = res;
      } else if (res && typeof res === 'object') {
        const message = (res as any).message;
        if (Array.isArray(message)) {
          error = message.join(', ');
        } else if (typeof message === 'string' && message.trim()) {
          error = message;
        } else {
          error = exception.message || error;
        }
      } else {
        error = exception.message || error;
      }
    }

    this.structuredLogger.error(GlobalExceptionFilter.name, 'HTTP request failed', {
      details: {
        eventType: 'HTTP',
        action: 'REQUEST_FAILED',
        method: request.method,
        path: request.url,
        statusCode: status,
      },
      error: exception instanceof Error
        ? exception
        : {
            message: error,
          },
    });

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        message: error,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}