import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request correlation ID middleware.
 *
 * - If `x-correlation-id` header is present on the incoming request, uses it.
 * - Otherwise generates a fresh UUID v4.
 * - Attaches `req.correlationId` for downstream handlers / loggers.
 * - Echoes it back on the response via `x-correlation-id` header so clients
 *   (mobile, web, ops) can correlate their logs with server logs.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const incoming = req.headers['x-correlation-id'];
    const id =
      typeof incoming === 'string' && incoming.trim().length > 0
        ? incoming.trim().slice(0, 128) // guard against abuse
        : uuidv4();

    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
