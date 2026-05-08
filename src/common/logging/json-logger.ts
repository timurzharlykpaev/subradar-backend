import type { LoggerService, LogLevel } from '@nestjs/common';

/**
 * Structured-JSON logger for production. Emits one JSON object per line on
 * stdout — DigitalOcean App Platform / Logs ingests stdout automatically
 * and indexes JSON fields for filtering and aggregation. Closes ASVS V7.3.3
 * (logs synchronously transmitted off-host) without bringing in nestjs-pino
 * or any other external logging stack.
 *
 * Output schema (per line):
 *   {
 *     "ts": "2026-05-08T12:34:56.789Z",
 *     "level": "log" | "error" | "warn" | "debug" | "verbose",
 *     "context": "AuthService",       // optional
 *     "msg": "Login success: u***@example.com",
 *     "trace": "Error: ...stack..."   // present only on error
 *   }
 *
 * Levels are forwarded to stdout (info-level) or stderr (error/warn) so
 * downstream tooling that filters by stream still works.
 *
 * Pre-existing call sites that pass JSON-stringified payloads keep working
 * — they're nested as a string inside `msg`, which is acceptable for
 * grep-style ops. Future code that wants real structured fields can pass
 * `message` as an object; we serialise it via JSON.stringify so the inner
 * shape is preserved verbatim.
 */
export class JsonLogger implements LoggerService {
  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    let msg: unknown;
    try {
      if (message === null || message === undefined) msg = String(message);
      else if (typeof message === 'string') msg = message;
      else if (message instanceof Error) msg = message.message;
      else msg = JSON.stringify(message);
    } catch {
      msg = String(message);
    }
    const line = {
      ts: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      msg,
      ...(trace ? { trace } : {}),
    };
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(line) + '\n');
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}
