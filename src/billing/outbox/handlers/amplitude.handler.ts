import { Injectable, Logger } from '@nestjs/common';

/**
 * Amplitude outbox handler.
 *
 * TODO(analytics): wire this to a real Amplitude (or replacement) client
 * once the team decides on a vendor. For now the backend has no
 * event-tracking service, so we log the payload at debug level and
 * acknowledge the event as processed — this keeps the outbox pipeline
 * exercised in dev/staging and lets call sites (state-machine
 * transitions, webhook handlers) enqueue events today without blocking
 * on infra.
 *
 * The payload shape is fixed here so producers have a stable contract:
 *   { event: string; userId: string; properties?: Record<string, unknown> }
 * When we light up a real client, only this handler needs to change.
 */
@Injectable()
export class AmplitudeHandler {
  private readonly logger = new Logger(AmplitudeHandler.name);

  async handle(payload: Record<string, unknown>): Promise<void> {
    const { event, userId, properties } = payload as {
      event: string;
      userId: string;
      properties?: Record<string, unknown>;
    };

    if (!event || !userId) {
      // Intentionally throw: malformed payloads indicate a producer bug
      // and should surface as an outbox failure rather than silently
      // being discarded.
      throw new Error(
        `AmplitudeHandler: malformed payload (event=${event}, userId=${userId})`,
      );
    }

    this.logger.debug(
      `[amplitude.track] ${event} user=${userId} props=${JSON.stringify(properties ?? {})}`,
    );
  }
}
