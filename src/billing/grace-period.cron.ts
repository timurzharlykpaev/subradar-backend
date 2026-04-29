import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';
import { UserBillingRepository } from './user-billing.repository';

@Injectable()
export class GracePeriodCron {
  private readonly logger = new Logger(GracePeriodCron.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Workspace) private readonly workspaceRepo: Repository<Workspace>,
    private readonly tg: TelegramAlertService,
    private readonly userBilling: UserBillingRepository,
  ) {}

  @Cron('5 0 * * *')
  async resetExpiredGrace() {
    await runCronHandler('resetExpiredGrace', this.logger, this.tg, async () => {
      const now = new Date();
      const users = await this.userRepo.find({
        where: { gracePeriodEnd: LessThan(now) as any },
      });
      let count = 0;
      for (const u of users) {
        // Route through the state machine — GRACE_EXPIRED is a no-op when
        // the user has already moved off grace, otherwise transitions to
        // free + clears period/source.
        await this.userBilling.applyTransition(
          u.id,
          { type: 'GRACE_EXPIRED' },
          { actor: 'cron_grace' },
        );
        count++;
      }
      this.logger.log(`Reset grace period for ${count} users`);
    });
  }

  @Cron('0 9 * * *')
  async cleanupAbandonedWorkspaces() {
    await runCronHandler('cleanupAbandonedWorkspaces', this.logger, this.tg, async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const workspaces = await this.workspaceRepo.find({
        where: { expiredAt: LessThan(cutoff) as any },
      });
      let count = 0;
      for (const w of workspaces) {
        try {
          await this.workspaceRepo.remove(w);
          count++;
        } catch (e) {
          this.logger.warn(`Failed to remove workspace ${w.id}: ${e}`);
        }
      }
      this.logger.log(`Cleaned up ${count} abandoned workspaces`);
    });
  }
}
