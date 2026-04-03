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
  ) {}

  /**
   * Every Monday at 09:00 UTC — trigger analysis for all Pro/Team users.
   */
  @Cron('0 9 * * 1')
  async weeklyAnalysisTrigger() {
    this.logger.log('Weekly analysis trigger cron started');

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
        } catch (error) {
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

    this.logger.log('Weekly analysis trigger cron completed');
  }

  /**
   * Every Monday at 12:00 UTC — send weekly digest emails to users with fresh results.
   */
  @Cron('0 12 * * 1')
  async weeklyDigestSend() {
    this.logger.log('Weekly digest send cron started');

    const eligiblePlans = ['pro', 'organization'];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
        select: ['id', 'email', 'name', 'locale'],
      });

      if (users.length === 0) break;

      for (const user of users) {
        try {
          const result = await this.resultRepo.findOne({
            where: {
              userId: user.id,
              createdAt: MoreThan(sevenDaysAgo),
            },
            order: { createdAt: 'DESC' },
          });

          if (!result) continue;

          await this.notifications.sendWeeklyDigest(user, result);
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

    this.logger.log('Weekly digest send cron completed');
  }

  /**
   * Every Sunday at 03:00 UTC — cleanup expired results and stuck jobs.
   */
  @Cron('0 3 * * 0')
  async cleanup() {
    this.logger.log('Analysis cleanup cron started');

    const now = new Date();

    // Delete expired results
    const expiredResults = await this.resultRepo.delete({
      expiresAt: LessThan(now),
    });
    this.logger.log(`Deleted ${expiredResults.affected ?? 0} expired analysis results`);

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
      job.error = 'Job timed out during cleanup';
      job.completedAt = now;
      await this.jobRepo.save(job);
    }

    this.logger.log(`Marked ${stuckJobs.length} stuck jobs as FAILED`);
    this.logger.log('Analysis cleanup cron completed');
  }
}
