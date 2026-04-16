import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Write an audit log row. Never throws — audit failure must not break the
   * business operation it's auditing. Callers should always `await` this so
   * that ordering is preserved, but they should NOT wrap it in extra catches.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.insert({
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        // TypeORM's QueryDeepPartialEntity narrows jsonb to a weird union; we
        // know the shape is fine because the entity type matches — bypass the
        // DeepPartialEntity inference with a cast rather than fighting it.
        metadata: (entry.metadata ?? null) as any,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      });
    } catch (err: any) {
      // Best-effort only — we keep going. A dropped audit entry is preferable
      // to blocking (e.g.) an account deletion because Postgres hiccupped.
      this.logger.warn(
        `Failed to write audit log (${entry.action}/${entry.resourceId ?? 'n/a'}): ${err?.message}`,
      );
    }
  }
}
