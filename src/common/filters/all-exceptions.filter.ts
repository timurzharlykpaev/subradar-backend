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

// Strip session-bearing values out of strings before they end up in logs or
// the Telegram alert channel. CASA / ASVS V7.1.1 forbids credential logging,
// and Telegram retains messages indefinitely on third-party infra.
const SECRET_PARAM_NAMES = [
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'code',
  'sig',
  'signature',
  'password',
  'otp',
  'apikey',
  'api_key',
  'secret',
  'session',
  'sessionid',
  'session_id',
  'cookie',
  'state',
];

function redactSecrets(input: string | undefined): string {
  if (!input) return '';
  let s = input;
  // Query/fragment params: ?token=abc&code=xyz → ?token=[REDACTED]&...
  for (const name of SECRET_PARAM_NAMES) {
    const re = new RegExp(`([?&#;]${name}=)[^&#\\s"']+`, 'gi');
    s = s.replace(re, `$1[REDACTED]`);
  }
  // Bearer / Basic auth headers in stack frames or stringified requests.
  s = s.replace(
    /(authorization:?\s*(?:bearer|basic)\s+)[A-Za-z0-9._\-+/=]+/gi,
    '$1[REDACTED]',
  );
  // Bare JWT-looking tokens (3 base64url segments separated by dots).
  s = s.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_JWT]',
  );
  // Defense-in-depth against log injection (V7.1.4): collapse CR/LF/ANSI.
  s = s.replace(/[\r\n]/g, ' ');
  return s;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  constructor(@Optional() private readonly tg?: TelegramAlertService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const isProd = process.env.NODE_ENV === 'production';
    const correlationId = request.correlationId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    const rawStack: string | undefined = (exception as any)?.stack;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'object'
          ? (exceptionResponse as any).message || exceptionResponse
          : exceptionResponse;
    } else {
      // Always log the full stack server-side — we still need it for debugging.
      const cidTag = correlationId ? ` [cid=${correlationId}]` : '';
      const safeUrl = redactSecrets(request.url);
      const safeMessage = redactSecrets(
        (exception as any)?.message
          ? String((exception as any).message)
          : String(exception),
      );
      const safeStack = redactSecrets(rawStack);
      this.logger.error(
        `Unhandled exception on ${request.method} ${safeUrl}${cidTag}: ${safeMessage}`,
        safeStack,
      );
      // In production, return a generic message to prevent info leakage via
      // unhandled-exception messages (which can include stack-trace-like detail).
      message = isProd
        ? 'Internal server error'
        : (exception as any)?.message || 'Internal server error';
    }

    const safeUrl = redactSecrets(request.url);

    // Alert on 5xx errors (skip health/silent paths)
    const isSilent = SILENT_PATHS.some((p) => request.url.startsWith(p));
    if (status >= 500 && !isSilent && this.tg) {
      const errMsg = redactSecrets(
        typeof message === 'string' ? message : JSON.stringify(message),
      );
      const stack = redactSecrets(rawStack).slice(0, 600);
      const tgText =
        `🔴 <b>Server Error 5xx [PROD]</b>\n` +
        `<code>${request.method} ${safeUrl}</code>\n` +
        `Status: <code>${status}</code>\n` +
        (correlationId ? `CID: <code>${correlationId}</code>\n` : '') +
        `\n<b>${errMsg}</b>` +
        (stack ? `\n\n<code>${stack}</code>` : '');
      this.tg
        .send(tgText, `${status}:${request.method}:${safeUrl}`)
        .catch(() => {});
    }

    // Redact `path` in the response body too: client-side error trackers
    // (Sentry, Crashlytics, Bugsnag, mobile log uploaders) ship the entire
    // response back to third-party infra, so a token in the request URL
    // would leak there even though the server logs/Telegram are clean.
    const body: Record<string, unknown> = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safeUrl,
      message,
      ...(correlationId ? { correlationId } : {}),
    };

    // Only expose the stack in non-production — never leak server internals to
    // clients in prod. Stack is already logged and sent to Telegram above.
    // Apply redaction even in dev so secret-laden test runs don't end up in
    // QA error trackers / Slack alerts.
    if (!isProd && rawStack) {
      body.stack = redactSecrets(rawStack);
    }

    response.status(status).json(body);
  }
}
