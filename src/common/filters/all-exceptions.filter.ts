import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TelegramAlertService } from '../telegram-alert.service';

// Paths that should never trigger Telegram alerts (health checks, bots, crawlers)
const SILENT_PATHS = ['/api/v1/auth/me', '/health', '/metrics', '/favicon'];

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  constructor(@Optional() private readonly tg?: TelegramAlertService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'object'
          ? (exceptionResponse as any).message || exceptionResponse
          : exceptionResponse;
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${(exception as any)?.message || exception}`,
        (exception as any)?.stack,
      );
      message = (exception as any)?.message || 'Internal server error';
    }

    // Alert on 5xx errors (skip health/silent paths)
    const isSilent = SILENT_PATHS.some((p) => request.url.startsWith(p));
    if (status >= 500 && !isSilent && this.tg) {
      const errMsg = typeof message === 'string' ? message : JSON.stringify(message);
      const stack = (exception as any)?.stack?.slice(0, 600) ?? '';
      const tgText =
        `🔴 <b>Server Error 5xx [PROD]</b>\n` +
        `<code>${request.method} ${request.url}</code>\n` +
        `Status: <code>${status}</code>\n` +
        `\n<b>${errMsg}</b>` +
        (stack ? `\n\n<code>${stack}</code>` : '');
      this.tg.send(tgText, `${status}:${request.method}:${request.url}`).catch(() => {});
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
