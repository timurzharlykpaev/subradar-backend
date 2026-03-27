import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceService } from './workspace.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@ApiTags('workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Post()
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

  @Post(':id/invite')
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
}
