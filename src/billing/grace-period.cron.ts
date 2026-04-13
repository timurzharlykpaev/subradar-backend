import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspace/entities/workspace.entity';

@Injectable()
export class GracePeriodCron {
  private readonly logger = new Logger(GracePeriodCron.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Workspace) private readonly workspaceRepo: Repository<Workspace>,
  ) {}

  @Cron('5 0 * * *')
  async resetExpiredGrace() {
    const now = new Date();
    const users = await this.userRepo.find({
      where: { gracePeriodEnd: LessThan(now) as any },
    });
    let count = 0;
    for (const u of users) {
      u.gracePeriodEnd = null;
      u.gracePeriodReason = null;
      await this.userRepo.save(u);
      count++;
    }
    this.logger.log(`Reset grace period for ${count} users`);
  }

  @Cron('0 9 * * *')
  async cleanupAbandonedWorkspaces() {
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
  }
}
