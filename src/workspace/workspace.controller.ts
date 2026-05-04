import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsDateString, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { RequirePlanCapability } from '../common/decorators/require-plan-capability.decorator';
import { WorkspaceService } from './workspace.service';
import { AnalysisService } from '../analysis/analysis.service';
import { ReportsService } from '../reports/reports.service';
import { ReportType } from '../reports/entities/report.entity';
import { AuditService } from '../common/audit/audit.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

class GenerateTeamReportDto {
  @ApiProperty({ enum: ReportType }) @IsEnum(ReportType) type: ReportType;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locale?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() displayCurrency?: string;
}

class ListMembersDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['spend', 'name', 'role'], default: 'spend' })
  @IsOptional() @IsString()
  sort?: 'spend' | 'name' | 'role';
}

@ApiTags('workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly analysisService: AnalysisService,
    private readonly reportsService: ReportsService,
    private readonly audit: AuditService,
  ) {}

  // Creating a workspace is an Organization-plan capability. We repeat
  // JwtAuthGuard here because method-level @UseGuards replaces the
  // class-level decorator in NestJS — skipping it would silently drop
  // authentication on this endpoint.
  @Post()
  @UseGuards(JwtAuthGuard, PlanGuard)
  @RequirePlanCapability('canCreateOrg')
  create(@Request() req, @Body() dto: CreateWorkspaceDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get('me/analytics')
  getMyWorkspaceAnalytics(
    @Request() req,
    @Query('displayCurrency') displayCurrency?: string,
  ) {
    return this.service.getWorkspaceAnalytics(req.user.id, displayCurrency);
  }

  @Get('me')
  async getMyWorkspace(@Request() req) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    // Always return JSON (null → {}) to avoid empty body crash on frontend
    return workspace ?? null;
  }

  @Get(':id')
  async findById(@Param('id') id: string, @Request() req) {
    const workspace = await this.service.findById(id);
    const isMember = workspace.members?.some(
      (m) => m.userId === req.user.id,
    );
    if (workspace.ownerId !== req.user.id && !isMember) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
    return workspace;
  }

  // Inviting teammates requires the Pro or Organization plan. Plan
  // gating here prevents free users from DoS-ing the invite email
  // sender and aligns with the billing/me.limits.canInvite flag.
  @Post(':id/invite')
  @UseGuards(JwtAuthGuard, PlanGuard)
  @RequirePlanCapability('canInvite')
  invite(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: InviteMemberDto,
  ) {
    return this.service.invite(id, req.user.id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') id: string,
    @Request() req,
    @Param('memberId') memberId: string,
  ) {
    return this.service.removeMember(id, req.user.id, memberId);
  }

  @Post(':id/invite-code')
  async generateInviteCode(@Param('id') id: string, @Request() req: any) {
    return this.service.generateInviteCode(id, req.user.id);
  }

  @Post('join/:code')
  async joinByCode(@Param('code') code: string, @Request() req: any) {
    return this.service.joinByCode(code, req.user.id);
  }

  @Post(':id/leave')
  async leave(@Param('id') id: string, @Request() req: any) {
    await this.service.leave(id, req.user.id);
    return { success: true };
  }

  @Delete(':id')
  async deleteWorkspace(@Param('id') id: string, @Request() req: any) {
    await this.service.deleteWorkspace(id, req.user.id);
    return { success: true };
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { name: string },
  ) {
    return this.service.renameWorkspace(id, req.user.id, body.name);
  }

  @Patch(':id/members/:memberId/role')
  async changeRole(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Request() req: any,
    @Body() body: { role: string },
  ) {
    return this.service.changeMemberRole(
      id,
      req.user.id,
      memberId,
      body.role as any,
    );
  }

  /** Owner/Admin can view a member's subscriptions (by workspace ID) */
  @Get(':id/members/:memberId/subscriptions')
  async getMemberSubscriptions(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Request() req: any,
  ) {
    return this.service.getMemberSubscriptions(id, req.user.id, memberId);
  }

  /** Owner/Admin can view a member's subscriptions (auto-detect workspace) */
  @Get('me/members/:memberId/subscriptions')
  async getMyMemberSubscriptions(
    @Param('memberId') memberId: string,
    @Request() req: any,
  ) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) throw new NotFoundException('No workspace found');
    return this.service.getMemberSubscriptions(workspace.id, req.user.id, memberId);
  }

  @Get('me/analysis/latest')
  async getAnalysisLatest(@Request() req: any) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) return null;
    return this.analysisService.getLatest(req.user.id, workspace.id);
  }

  @Post('me/analysis/run')
  async runAnalysis(@Request() req: any) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) throw new NotFoundException('No workspace found');
    return this.analysisService.run(req.user.id, 'MANUAL' as any, workspace.id);
  }

  /**
   * Owner-only paginated members list with sort. Used by the mobile
   * Reports / Team-overview screens — the legacy `/me/analytics`
   * embeds members[] inline which scales poorly past ~20 members.
   */
  @Get('me/members')
  async listMembers(@Request() req: any, @Query() query: ListMembersDto) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) throw new NotFoundException('No workspace found');
    return this.service.listMembersPaginated(workspace.id, req.user.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'spend',
    });
  }

  /**
   * Owner-only — surface the most recent AI-detected duplicate
   * services across the workspace, with computed potential savings.
   * Reads from the analysis result so it's free (no fresh AI call).
   *
   * Owner-only is enforced both here (controller) and inside the
   * service — keep the check symmetric with `generateTeamReport` so
   * a partial code change can't accidentally widen access.
   */
  @Get('me/overlaps')
  async getOverlaps(@Request() req: any) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) throw new NotFoundException('No workspace found');
    if (workspace.ownerId !== req.user.id) {
      throw new ForbiddenException('Only the workspace owner can view team overlaps');
    }
    return this.service.getTeamOverlaps(workspace.id, req.user.id);
  }

  /**
   * Owner-only team report — kicks off async PDF generation that
   * aggregates subscriptions across every active workspace member.
   * The PDF file lives in the same Redis bucket as personal reports
   * (`report:pdf:{id}`) and is fetched via the existing
   * `GET /reports/{id}/download` endpoint, so no new download path
   * is needed on the mobile side.
   */
  @Post('me/reports/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateTeamReport(
    @Request() req: any,
    @Body() dto: GenerateTeamReportDto,
  ) {
    const workspace = await this.service.getMyWorkspace(req.user.id);
    if (!workspace) throw new NotFoundException('No workspace found');
    if (workspace.ownerId !== req.user.id) {
      throw new ForbiddenException('Only the workspace owner can generate team reports');
    }
    const from = dto.from || new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
    const to = dto.to || new Date().toISOString().split('T')[0];
    const report = await this.reportsService.generateTeam(
      req.user.id,
      workspace.id,
      from,
      to,
      dto.type,
      dto.locale,
      dto.displayCurrency,
    );
    // Compliance trail: team reports include per-member name + email,
    // so we record who pulled the data and when. Required for the
    // "data exports" audit pattern most B2B saas adopt under GDPR /
    // SOC 2.
    await this.audit.log({
      userId: req.user.id,
      action: 'workspace.team_report_generated',
      resourceType: 'workspace',
      resourceId: workspace.id,
      metadata: { reportId: report.id, type: dto.type, from, to },
    });
    return report;
  }
}
