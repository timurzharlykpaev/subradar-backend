import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import {
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from './entities/workspace-member.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
  ) {}

  async create(ownerId: string, dto: CreateWorkspaceDto): Promise<Workspace> {
    const workspace = this.workspaceRepo.create({ ...dto, ownerId });
    const saved = await this.workspaceRepo.save(workspace);

    // Add owner as OWNER member
    const member = this.memberRepo.create({
      workspaceId: saved.id,
      userId: ownerId,
      role: WorkspaceMemberRole.OWNER,
      status: WorkspaceMemberStatus.ACTIVE,
    });
    await this.memberRepo.save(member);

    // Return with members relation loaded
    return this.findById(saved.id);
  }

  async findById(id: string): Promise<Workspace> {
    const ws = await this.workspaceRepo.findOne({
      where: { id },
      relations: ['members'],
    });
    if (!ws) throw new NotFoundException('Workspace not found');
    return ws;
  }

  async getMyWorkspace(userId: string): Promise<Workspace | null> {
    const member = await this.memberRepo.findOne({
      where: { userId, status: WorkspaceMemberStatus.ACTIVE },
    });
    if (!member) return null;
    return this.workspaceRepo.findOne({
      where: { id: member.workspaceId },
      relations: ['members'],
    });
  }

  async invite(
    workspaceId: string,
    requesterId: string,
    dto: InviteMemberDto,
  ): Promise<WorkspaceMember> {
    const workspace = await this.findById(workspaceId);
    if (workspace.ownerId !== requesterId)
      throw new ForbiddenException('Only owner can invite members');

    const members = await this.memberRepo.count({
      where: { workspaceId, status: WorkspaceMemberStatus.ACTIVE },
    });
    if (members >= workspace.maxMembers)
      throw new BadRequestException('Workspace member limit reached');

    const member = this.memberRepo.create({
      workspaceId,
      inviteEmail: dto.email,
      role: dto.role || WorkspaceMemberRole.MEMBER,
      status: WorkspaceMemberStatus.PENDING,
    });
    return this.memberRepo.save(member);
  }

  async removeMember(
    workspaceId: string,
    requesterId: string,
    memberId: string,
  ): Promise<void> {
    const workspace = await this.findById(workspaceId);
    if (workspace.ownerId !== requesterId)
      throw new ForbiddenException('Only owner can remove members');
    await this.memberRepo.delete({ id: memberId, workspaceId });
  }
}
