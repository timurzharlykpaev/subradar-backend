import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan, MoreThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisJob, AnalysisJobStatus } from './entities/analysis-job.entity';
import { AnalysisService } from './analysis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalysisTriggerType } from './entities/analysis-job.entity';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';

@Injectable()
export class AnalysisCronService {
  private readonly logger = new Logger(AnalysisCronService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AnalysisResult)
    private readonly resultRepo: Repository<AnalysisResult>,
    @InjectRepository(AnalysisJob)
    private readonly jobRepo: Repository<AnalysisJob>,
    private readonly analysisService: AnalysisService,
    private readonly notifications: NotificationsService,
    private readonly tg: TelegramAlertService,
  ) {}

  /**
   * Every Monday at 09:00 UTC — trigger analysis for all Pro/Team users.
   */
  @Cron('0 9 * * 1')
  async weeklyAnalysisTrigger() {
    return runCronHandler('weeklyAnalysisTrigger', this.logger, this.tg, async () => {
      const eligiblePlans = ['pro', 'organization'];
      const batchSize = 50;
      let offset = 0;

      while (true) {
        const users = await this.userRepo.find({
          where: { plan: In(eligiblePlans), isActive: true },
          take: batchSize,
          skip: offset,
          select: ['id', 'plan', 'trialEndDate'],
        });

        if (users.length === 0) break;

        for (const user of users) {
          try {
            await this.analysisService.run(user.id, AnalysisTriggerType.CRON);
          } catch (error: any) {
            this.logger.warn(
              `Weekly analysis trigger failed for user ${user.id}: ${error.message}`,
            );
          }
        }

        offset += batchSize;

        if (users.length < batchSize) break;

        // 1s pause between batches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });
  }

  /**
   * Every Monday at 12:00 UTC — send weekly digest emails to users with fresh results.
   *
   * Idempotency: checks `weeklyDigestSentAt` before sending. If the cron fires
   * twice within a 6-day window (e.g. manual trigger, overlapping runs, or a
   * scheduler bug), the same user won't receive two digests.
   */
  @Cron('0 12 * * 1')
  async weeklyDigestSend() {
    return runCronHandler('weeklyDigestSend', this.logger, this.tg, () =>
      this.weeklyDigestSendImpl(),
    );
  }

  private async weeklyDigestSendImpl() {
    const eligiblePlans = ['pro', 'organization'];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const batchSize = 50;
    let offset = 0;

    while (true) {
      const users = await this.userRepo.find({
        where: {
          weeklyDigestEnabled: true,
          plan: In(eligiblePlans),
          isActive: true,
        },
        take: batchSize,
        skip: offset,
        select: ['id', 'email', 'name', 'locale', 'weeklyDigestSentAt'],
      });

      if (users.length === 0) break;

      for (const user of users) {
        try {
          // Idempotency guard — skip if we already sent within the last 6 days.
          if (user.weeklyDigestSentAt && user.weeklyDigestSentAt > sixDaysAgo) {
            continue;
          }

          const result = await this.resultRepo.findOne({
            where: {
              userId: user.id,
              createdAt: MoreThan(sevenDaysAgo),
            },
            order: { createdAt: 'DESC' },
          });

          if (!result) continue;

          await this.notifications.sendWeeklyDigest(user, result);

          // Mark as sent — atomic update so a second concurrent cron instance
          // doesn't double-send if it raced past our in-memory check.
          await this.userRepo.update(user.id, { weeklyDigestSentAt: new Date() });
        } catch (error) {
          this.logger.warn(
            `Weekly digest send failed for user ${user.id}: ${error.message}`,
          );
        }
      }

      offset += batchSize;

      if (users.length < batchSize) break;

      // 1s pause between batches
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Every Sunday at 03:00 UTC — cleanup expired results and stuck jobs.
   */
  @Cron('0 3 * * 0')
  async cleanup() {
    return runCronHandler('analysisCleanup', this.logger, this.tg, async () => {
      const now = new Date();

      // Delete expired results
      const expiredResults = await this.resultRepo.delete({
        expiresAt: LessThan(now),
      });
      this.logger.log(
        `Deleted ${expiredResults.affected ?? 0} expired analysis results`,
      );

      // Fail stuck jobs (created more than 1 hour ago and still in-progress)
      const stuckCutoff = new Date(Date.now() - 60 * 60 * 1000);
      const stuckJobs = await this.jobRepo.find({
        where: {
          status: In([
            AnalysisJobStatus.QUEUED,
            AnalysisJobStatus.COLLECTING,
            AnalysisJobStatus.NORMALIZING,
            AnalysisJobStatus.LOOKING_UP,
            AnalysisJobStatus.ANALYZING,
          ]),
          createdAt: LessThan(stuckCutoff),
        },
      });

      for (const job of stuckJobs) {
        job.status = AnalysisJobStatus.FAILED;
        // Preserve the original failure reason if the job captured one before
        // hanging (e.g. OpenAI timeout, DB error). Overwriting with the generic
        // cleanup message would destroy the diagnostic trail.
        if (!job.error || job.error.trim().length === 0) {
          job.error = 'Job timed out during cleanup';
        }
        job.completedAt = now;
        await this.jobRepo.save(job);
      }

      this.logger.log(`Marked ${stuckJobs.length} stuck jobs as FAILED`);
    });
  }
}
