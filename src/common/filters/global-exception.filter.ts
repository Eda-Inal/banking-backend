import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method: string; url: string; traceId?: string }>();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = (res as any).message;
      if (Array.isArray(message)) {
        error = message.join(', ');
      } else {
        error = message;
      }
    }

    const traceId = request.traceId ?? 'no-trace-id';
    this.logger.error(
      `[${traceId}] ${request.method} ${request.url} -> ${status} - ${error}`,
      exception instanceof Error ? exception.stack : undefined,
    );

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