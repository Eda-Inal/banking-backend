import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx= host.switchToHttp();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = (res as any).message;
      if(Array.isArray(message)) {
        error = message.join(', ');
      } else {
        error = message;
      }
    }
    response.status(status).json({
        success: false,
        error:{
            statusCode: status,
            message: error,
        },
 
        timestamp: new Date().toISOString(),
        path: ctx.getRequest().url,
    });
  }
}