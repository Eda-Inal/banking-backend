import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, Observable } from 'rxjs';


@Injectable()
export class SuccessResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => ({
      success: true,
      data,
      meta: {},
      timestamp: new Date().toISOString(),
      path: context.switchToHttp().getRequest().url,
    })));
  }
}