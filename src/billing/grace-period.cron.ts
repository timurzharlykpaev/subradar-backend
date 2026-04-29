import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';

@Injectable()
export class GracePeriodCron {
  private readonly logger = new Logger(GracePeriodCron.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Workspace) private readonly workspaceRepo: Repository<Workspace>,
    private readonly tg: TelegramAlertService,
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
        // Grace ran out — drop the user back to free. Earlier this only
        // wiped gracePeriodEnd, leaving `billingStatus` stuck on
        // `grace_pro` / `grace_team` and `plan` on the old paid tier, so
        // EffectiveAccessResolver kept granting paid access indefinitely.
        const wasGracePro = u.billingStatus === 'grace_pro';
        const wasGraceTeam = u.billingStatus === 'grace_team';
        u.gracePeriodEnd = null;
        u.gracePeriodReason = null;
        if (wasGracePro || wasGraceTeam) {
          u.billingStatus = 'free' as any;
          u.cancelAtPeriodEnd = false;
          u.currentPeriodEnd = null as any;
          // grace_team users may have had no own subscription (they relied
          // on a team owner) — only flip plan if it was paid.
          if (u.plan !== 'free') u.plan = 'free' as any;
          if (wasGracePro) u.billingSource = null as any;
        }
        await this.userRepo.save(u);
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
