import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { RequirePlanCapability } from '../common/decorators/require-plan-capability.decorator';
import { WorkspaceService } from './workspace.service';
import { AnalysisService } from '../analysis/analysis.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@ApiTags('workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly analysisService: AnalysisService,
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
  getMyWorkspaceAnalytics(@Request() req) {
    return this.service.getWorkspaceAnalytics(req.user.id);
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
}
