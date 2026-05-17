import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';

/**
 * On-upload antivirus scanning via ClamAV. Satisfies CASA Tier 2 SAQ #10
 * — files obtained from untrusted sources (receipt uploads, screenshot AI
 * parses, voice-to-subscription audio) are scanned against ClamAV's
 * signature database before any storage or downstream processing.
 *
 * Two operational knobs are exposed via env vars:
 *   AV_ENABLED   default `false`. Master switch. When false the service is
 *                a no-op so deploy-then-flip rollout is possible (deploy
 *                backend first, stand up the ClamAV daemon, flip the flag).
 *   AV_FAIL_OPEN default `true`. If the daemon is unreachable or returns
 *                an error, fail-open (log + allow upload) so a clamd
 *                outage doesn't take down the upload path. Set to false
 *                in strict-compliance environments where missing scans
 *                must surface as 503.
 *
 * Wire details:
 *   CLAMAV_HOST  default `subradar-clamav` (docker network DNS).
 *   CLAMAV_PORT  default `3310`.
 */
@Injectable()
export class AntivirusService implements OnModuleInit {
  private readonly logger = new Logger(AntivirusService.name);
  private clamscan: any = null;
  private readonly enabled: boolean;
  private readonly failOpen: boolean;

  constructor(
    private readonly cfg: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.enabled = this.cfg.get<string>('AV_ENABLED') === 'true';
    this.failOpen = this.cfg.get<string>('AV_FAIL_OPEN', 'true') !== 'false';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'Antivirus scanning is DISABLED (AV_ENABLED != "true"). Uploads will not be scanned.',
      );
      return;
    }
    try {
      // Dynamic require so dev environments without the optional native
      // dep don't break NestFactory.create on module load.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NodeClam } = require('clamscan');
      const host = this.cfg.get<string>('CLAMAV_HOST', 'subradar-clamav');
      const port = parseInt(
        this.cfg.get<string>('CLAMAV_PORT', '3310') ?? '3310',
        10,
      );
      this.clamscan = await new NodeClam().init({
        debugMode: false,
        clamdscan: {
          host,
          port,
          timeout: 60_000,
          localFallback: false,
        },
        preference: 'clamdscan',
      });
      this.logger.log(
        `Antivirus scanner initialised (clamd @ ${host}:${port}, failOpen=${this.failOpen})`,
      );
    } catch (e) {
      this.clamscan = null;
      this.logger.error(
        `Failed to initialise clamscan: ${(e as Error)?.message}`,
      );
      if (!this.failOpen) {
        // Surface fast-fail in strict mode so a broken AV install can't
        // silently disable scanning.
        throw e;
      }
    }
  }

  /**
   * Scan a buffer. Returns void on clean files; throws BadRequestException
   * on positive virus hits. Connection / daemon errors honour the
   * `failOpen` config (log + return, vs. throw ServiceUnavailable).
   *
   * `label` is opaque metadata (`receipt`, `screenshot`, `voice-audio`)
   * surfaced into structured logs and audit rows.
   */
  async scanBuffer(
    buffer: Buffer,
    opts: { userId?: string; label?: string; ipAddress?: string | null } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    if (!buffer || buffer.length === 0) return;

    if (!this.clamscan) {
      if (this.failOpen) {
        this.logger.warn(
          `AV scan skipped — daemon not initialised (label=${opts.label ?? 'unknown'})`,
        );
        return;
      }
      throw new ServiceUnavailableException(
        'Antivirus scanner is currently unavailable. Please retry shortly.',
      );
    }

    try {
      const result = await this.clamscan.scanBuffer(
        buffer,
        // Pass the label so debug logs from clamscan are meaningful.
        opts.label ?? 'upload',
      );
      const { isInfected, viruses } = result || {};
      if (isInfected) {
        this.logger.warn(
          `Virus detected in upload (label=${opts.label ?? 'unknown'} userId=${opts.userId ?? 'anon'}): ${(viruses || []).join(', ')}`,
        );
        // Audit the hit — CASA / ASVS V7.1.x requires malicious-upload
        // detection events to be recorded. The audit payload deliberately
        // does NOT include the file bytes or filename — only the detected
        // signature name + label so the operator can investigate without
        // storing the malware sample anywhere.
        try {
          await this.audit.log({
            userId: opts.userId ?? null,
            action: 'antivirus.detection',
            ipAddress: opts.ipAddress ?? null,
            userAgent: null,
            metadata: {
              label: opts.label ?? 'unknown',
              signatures: viruses || [],
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
    } catch (e) {
      // Re-throw the rejection unchanged so the controller sends a 400.
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(
        `AV scan error (label=${opts.label ?? 'unknown'}): ${(e as Error)?.message}`,
      );
      if (this.failOpen) return;
      throw new ServiceUnavailableException(
        'Antivirus scanner error. Please retry shortly.',
      );
    }
  }
}
