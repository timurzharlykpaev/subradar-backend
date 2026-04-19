import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuppressedEmail } from './entities/suppressed-email.entity';
import { maskEmail } from '../common/utils/pii';

/**
 * Read/write the email suppression list. Encapsulates the lowercase
 * normalisation so callers don't have to think about case sensitivity.
 */
@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);

  constructor(
    @InjectRepository(SuppressedEmail)
    private readonly repo: Repository<SuppressedEmail>,
  ) {}

  private normalise(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  async isSuppressed(email: string): Promise<boolean> {
    const e = this.normalise(email);
    if (!e) return false;
    const found = await this.repo.findOne({ where: { email: e } });
    return !!found;
  }

  /**
   * Upsert a suppression entry. Existing rows have their reason/context
   * updated rather than being duplicated — keeps the table compact and the
   * unique index intact under concurrent webhook deliveries.
   */
  async suppress(
    email: string,
    reason: SuppressedEmail['reason'],
    context?: string | null,
  ): Promise<void> {
    const e = this.normalise(email);
    if (!e) return;
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(SuppressedEmail)
        .values({ email: e, reason, context: context ?? null })
        .orUpdate(['reason', 'context'], ['email'])
        .execute();
      this.logger.log(`Suppressed ${maskEmail(e)} (${reason})`);
    } catch (err: any) {
      this.logger.warn(`Failed to suppress ${maskEmail(e)}: ${err?.message ?? err}`);
    }
  }

  async unsuppress(email: string): Promise<void> {
    const e = this.normalise(email);
    if (!e) return;
    await this.repo.delete({ email: e });
  }
}
