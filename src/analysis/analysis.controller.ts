import { Controller, Get, Post, Param, UseGuards, Request, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalysisPlanGuard } from './guards/plan.guard';
import { AnalysisService } from './analysis.service';
import { AnalysisTriggerType } from './entities/analysis-job.entity';

@Controller('analysis')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('latest')
  @UseGuards(AnalysisPlanGuard)
  async getLatest(@Request() req: any) {
    const { latestResult, activeJob, canRunManual } = await this.analysisService.getLatest(req.user.id);
    const result = latestResult;
    const job = activeJob;
    const nextAutoAnalysis: string | null = null;
    return {
      result: result ? {
        id: result.id, summary: result.summary,
        totalMonthlySavings: Number(result.totalMonthlySavings),
        currency: result.currency, recommendations: result.recommendations,
        duplicates: result.duplicates, overlaps: result.overlaps,
        teamSavings: result.teamSavings ? Number(result.teamSavings) : null,
        memberCount: result.memberCount, subscriptionCount: result.subscriptionCount,
        createdAt: result.createdAt.toISOString(), expiresAt: result.expiresAt.toISOString(),
      } : null,
      job: job ? { id: job.id, status: job.status, createdAt: job.createdAt.toISOString() } : null,
      canRunManual, nextAutoAnalysis,
    };
  }

  @Get('status/:jobId')
  @UseGuards(AnalysisPlanGuard)
  async getStatus(@Param('jobId') jobId: string, @Request() req: any) {
    const job = await this.analysisService.getJobStatus(jobId, req.user.id);
    if (!job) throw new ForbiddenException('Job not found');
    return {
      id: job.id, status: job.status, stageProgress: job.stageProgress,
      resultId: job.resultId, error: job.error,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
    };
  }

  @Post('run')
  @UseGuards(AnalysisPlanGuard)
  @HttpCode(HttpStatus.OK)
  async run(@Request() req: any) {
    const result = await this.analysisService.run(req.user.id, AnalysisTriggerType.MANUAL);
    if (result.retryAfter !== undefined && result.retryAfter > 0) {
      return { error: 'COOLDOWN', retryAfter: result.retryAfter };
    }
    if (result.cached) return { cached: true, resultId: result.resultId };
    return { jobId: result.jobId, status: result.status };
  }

  @Get('usage')
  @UseGuards(AnalysisPlanGuard)
  async getUsage(@Request() req: any) {
    const usage = await this.analysisService.getUsageStats(req.user.id);
    if (!usage) throw new ForbiddenException({ error: 'PLAN_REQUIRED', requiredPlan: 'pro' });
    return usage;
  }
}
