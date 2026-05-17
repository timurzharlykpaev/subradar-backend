import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { AuditService } from '../audit/audit.service';

/**
 * On-upload antivirus scanning via ClamAV. Satisfies CASA Tier 2 SAQ #10
 * — files obtained from untrusted sources (receipt uploads, screenshot AI
 * parses, voice-to-subscription audio) are scanned against ClamAV's
 * signature database before any storage or downstream processing.
 *
 * Implementation: native TCP INSTREAM protocol against `clamd`. This avoids
 * the `clamscan` npm wrapper entirely — that library is a thin shim with
 * its own bugs (the v2.x release silently dropped scanBuffer and ships an
 * occasionally-broken scanStream), and our needs fit on ~40 lines of pure
 * socket code without the surface area.
 *
 * Knobs (env vars):
 *   AV_ENABLED   default `false`. Master switch. When false the service is
 *                a no-op so deploy-then-flip rollout is possible (deploy
 *                backend first, stand up the ClamAV daemon, flip the flag).
 *   AV_FAIL_OPEN default `true`. If the daemon is unreachable or returns
 *                an error, fail-open (log + allow upload) so a clamd
 *                outage doesn't take down the upload path. Set to false
 *                in strict-compliance environments where missing scans
 *                must surface as 503.
 *   CLAMAV_HOST  default `subradar-clamav` (docker network DNS).
 *   CLAMAV_PORT  default `3310`.
 *   CLAMAV_TIMEOUT_MS  default `30000`. Per-scan socket timeout.
 */
@Injectable()
export class AntivirusService implements OnModuleInit {
  private readonly logger = new Logger(AntivirusService.name);
  private readonly enabled: boolean;
  private readonly failOpen: boolean;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private ready = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.enabled = this.cfg.get<string>('AV_ENABLED') === 'true';
    this.failOpen = this.cfg.get<string>('AV_FAIL_OPEN', 'true') !== 'false';
    this.host = this.cfg.get<string>('CLAMAV_HOST', 'subradar-clamav');
    this.port = parseInt(
      this.cfg.get<string>('CLAMAV_PORT', '3310') ?? '3310',
      10,
    );
    this.timeoutMs = parseInt(
      this.cfg.get<string>('CLAMAV_TIMEOUT_MS', '30000') ?? '30000',
      10,
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'Antivirus scanning is DISABLED (AV_ENABLED != "true"). Uploads will not be scanned.',
      );
      return;
    }
    // Probe clamd with a PING — establishes the daemon is reachable on
    // boot rather than on the first user upload, so a misconfigured network
    // surfaces in deploy logs instead of a runtime alert.
    try {
      const pong = await this.ping();
      if (pong.trim() !== 'PONG') {
        throw new Error(`unexpected clamd reply: ${pong}`);
      }
      this.ready = true;
      this.logger.log(
        `Antivirus scanner ready (clamd @ ${this.host}:${this.port}, failOpen=${this.failOpen})`,
      );
    } catch (e) {
      this.ready = false;
      this.logger.error(
        `clamd PING failed at ${this.host}:${this.port}: ${(e as Error)?.message}`,
      );
      if (!this.failOpen) throw e;
    }
  }

  /**
   * Scan a buffer. Resolves on clean files; throws BadRequestException on a
   * positive virus hit. Daemon errors honour `failOpen` (log + return vs.
   * throw 503).
   *
   * `label` is opaque metadata (`receipt-upload`, `ai-screenshot`, etc.)
   * surfaced into logs + the `antivirus.detection` audit row.
   */
  async scanBuffer(
    buffer: Buffer,
    opts: { userId?: string; label?: string; ipAddress?: string | null } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    if (!buffer || buffer.length === 0) return;

    if (!this.ready) {
      if (this.failOpen) {
        this.logger.warn(
          `AV scan skipped — daemon not ready (label=${opts.label ?? 'unknown'})`,
        );
        return;
      }
      throw new ServiceUnavailableException(
        'Antivirus scanner is currently unavailable. Please retry shortly.',
      );
    }

    let scanReply: string;
    try {
      scanReply = await this.scanInStream(buffer);
    } catch (e) {
      this.logger.warn(
        `AV scan error (label=${opts.label ?? 'unknown'}): ${(e as Error)?.message}`,
      );
      if (this.failOpen) return;
      throw new ServiceUnavailableException(
        'Antivirus scanner error. Please retry shortly.',
      );
    }

    // clamd INSTREAM replies look like:
    //   "stream: OK"                       — clean
    //   "stream: Eicar-Test-Signature FOUND" — infected
    //   "stream: SIZE LIMIT EXCEEDED"      — buffer too large (very rare for our limits)
    const cleaned = scanReply.trim();
    if (cleaned.endsWith('FOUND')) {
      const match = cleaned.match(/stream:\s*(.+?)\s*FOUND$/);
      const signature = match ? match[1] : 'unknown';
      this.logger.warn(
        `Virus detected in upload (label=${opts.label ?? 'unknown'} userId=${opts.userId ?? 'anon'}): ${signature}`,
      );
      // Audit the hit — CASA / ASVS V7.1.x requires malicious-upload
      // detection events to be recorded. Payload deliberately does NOT
      // include file bytes or filename — only signature + label so the
      // operator can investigate without keeping malware samples around.
      try {
        await this.audit.log({
          userId: opts.userId ?? null,
          action: 'antivirus.detection',
          ipAddress: opts.ipAddress ?? null,
          userAgent: null,
          metadata: {
            label: opts.label ?? 'unknown',
            signature,
            size: buffer.length,
          },
        });
      } catch {
        // Audit failures must not mask the original detection response.
      }
      throw new BadRequestException(
        'The uploaded file did not pass the malware scan and was rejected.',
      );
    }

    // Clean file — debug log so operators can confirm scans are happening
    // in production traffic. Use debug not log to keep the prod log volume
    // manageable; for periodic compliance evidence, query the access log
    // joined to AntivirusService traces.
    this.logger.debug(
      `AV scan clean (label=${opts.label ?? 'unknown'} size=${buffer.length}B)`,
    );
  }

  /** PING command — verifies clamd is up. */
  private ping(): Promise<string> {
    return this.tcpCall((sock) => sock.write('zPING\0'));
  }

  /**
   * INSTREAM protocol: send `zINSTREAM\0`, then chunks prefixed by a
   * 4-byte big-endian length, then a zero-length chunk to signal EOF.
   * clamd replies with `stream: ...` and closes the connection.
   */
  private scanInStream(buffer: Buffer): Promise<string> {
    return this.tcpCall((sock) => {
      sock.write('zINSTREAM\0');
      // Send the whole buffer as a single chunk — clamd handles up to
      // StreamMaxLength (default 25 MiB in clamav.conf, more than our
      // Multer limits of 10 MiB images / 25 MiB audio).
      const lenPrefix = Buffer.alloc(4);
      lenPrefix.writeUInt32BE(buffer.length, 0);
      sock.write(lenPrefix);
      sock.write(buffer);
      // End-of-stream marker.
      sock.write(Buffer.alloc(4));
    });
  }

  /**
   * Generic clamd TCP request/response: open a connection, run the
   * caller's `send()` function, accumulate the response, return on close.
   * Times out after this.timeoutMs and destroys the socket so we don't
   * leak FDs on a stalled daemon.
   */
  private tcpCall(
    send: (sock: net.Socket) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      let response = Buffer.alloc(0);
      let settled = false;
      const finish = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          sock.destroy();
        } catch {
          // socket may already be closed
        }
        if (err) reject(err);
        else resolve(value ?? '');
      };
      const timer = setTimeout(
        () => finish(new Error(`clamd timeout after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      sock.once('connect', () => {
        try {
          send(sock);
        } catch (e) {
          finish(e as Error);
        }
      });
      sock.on('data', (chunk) => {
        response = Buffer.concat([response, chunk]);
      });
      sock.once('end', () => {
        // Strip the trailing NUL clamd appends in `z*` mode.
        finish(null, response.toString('utf8').replace(/\0+$/, ''));
      });
      sock.once('error', (e) => finish(e));
    });
  }
}
