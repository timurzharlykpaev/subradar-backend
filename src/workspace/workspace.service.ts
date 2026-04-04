import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import {
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from './entities/workspace-member.entity';
import { InviteCode } from './entities/invite-code.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import {
  Subscription,
  SubscriptionStatus,
  BillingPeriod,
} from '../subscriptions/entities/subscription.entity';

@Injectable()
export class WorkspaceService {
  private readonly INVITE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(InviteCode)
    private readonly inviteCodeRepo: Repository<InviteCode>,
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
      relations: ['members', 'members.user'],
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
      relations: ['members', 'members.user'],
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

  async generateInviteCode(workspaceId: string, requesterId: string) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (
      !requester ||
      (requester.role !== WorkspaceMemberRole.OWNER &&
        requester.role !== WorkspaceMemberRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'Only owner or admin can generate invite codes',
      );
    }

    // Check max 5 active codes
    const activeCodes = await this.inviteCodeRepo.count({
      where: {
        workspaceId,
        usedBy: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (activeCodes >= 5) {
      throw new BadRequestException(
        'Maximum 5 active invite codes. Wait for existing codes to expire or be used.',
      );
    }

    // Generate unique 6-char code
    let code: string;
    let attempts = 0;
    do {
      code = Array.from(
        { length: 6 },
        () =>
          this.INVITE_CHARSET[
            Math.floor(Math.random() * this.INVITE_CHARSET.length)
          ],
      ).join('');
      attempts++;
    } while (
      attempts < 10 &&
      (await this.inviteCodeRepo.findOne({ where: { code } }))
    );

    const inviteCode = this.inviteCodeRepo.create({
      workspaceId,
      code,
      createdBy: requesterId,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    await this.inviteCodeRepo.save(inviteCode);

    return { code: inviteCode.code, expiresAt: inviteCode.expiresAt };
  }

  async joinByCode(code: string, userId: string) {
    const inviteCode = await this.inviteCodeRepo.findOne({
      where: { code, usedBy: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!inviteCode) {
      throw new BadRequestException('Invalid or expired invite code');
    }

    const workspace = await this.workspaceRepo.findOne({
      where: { id: inviteCode.workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    // Check not already member
    if (
      workspace.members.some(
        (m) =>
          m.userId === userId &&
          m.status === WorkspaceMemberStatus.ACTIVE,
      )
    ) {
      throw new BadRequestException(
        'You are already a member of this workspace',
      );
    }

    // Check not full
    const activeCount = workspace.members.filter(
      (m) => m.status === WorkspaceMemberStatus.ACTIVE,
    ).length;
    if (activeCount >= workspace.maxMembers) {
      throw new BadRequestException('Workspace is full');
    }

    // Mark code as used
    inviteCode.usedBy = userId;
    inviteCode.usedAt = new Date();
    await this.inviteCodeRepo.save(inviteCode);

    // Create member
    const member = this.memberRepo.create({
      workspaceId: workspace.id,
      userId,
      role: WorkspaceMemberRole.MEMBER,
      status: WorkspaceMemberStatus.ACTIVE,
    });
    await this.memberRepo.save(member);

    return this.findById(workspace.id);
  }

  async leave(workspaceId: string, userId: string) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const member = workspace.members.find((m) => m.userId === userId);
    if (!member) throw new NotFoundException('Not a member of this workspace');
    if (member.role === WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException(
        'Owner cannot leave. Delete the workspace instead.',
      );
    }

    await this.memberRepo.remove(member);
  }

  async deleteWorkspace(workspaceId: string, requesterId: string) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (!requester || requester.role !== WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException('Only owner can delete workspace');
    }

    await this.inviteCodeRepo.delete({ workspaceId });
    await this.memberRepo.delete({ workspaceId });
    await this.workspaceRepo.remove(workspace);
  }

  async renameWorkspace(
    workspaceId: string,
    requesterId: string,
    name: string,
  ) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (
      !requester ||
      (requester.role !== WorkspaceMemberRole.OWNER &&
        requester.role !== WorkspaceMemberRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'Only owner or admin can rename workspace',
      );
    }

    workspace.name = name;
    return this.workspaceRepo.save(workspace);
  }

  async changeMemberRole(
    workspaceId: string,
    requesterId: string,
    memberId: string,
    role: WorkspaceMemberRole,
  ) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (!requester || requester.role !== WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException('Only owner can change roles');
    }

    const member = workspace.members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException('Cannot change owner role');
    }

    member.role = role;
    return this.memberRepo.save(member);
  }

  private toMonthlyAmount(amount: number, period: BillingPeriod): number {
    const map: Record<BillingPeriod, number> = {
      [BillingPeriod.WEEKLY]: amount * 4.33,
      [BillingPeriod.MONTHLY]: amount,
      [BillingPeriod.QUARTERLY]: amount / 3,
      [BillingPeriod.YEARLY]: amount / 12,
      [BillingPeriod.LIFETIME]: 0,
      [BillingPeriod.ONE_TIME]: 0,
    };
    return map[period] ?? amount;
  }

  async getWorkspaceAnalytics(userId: string) {
    const workspace = await this.getMyWorkspace(userId);
    if (!workspace) throw new NotFoundException('Workspace not found');

    const activeMembers = workspace.members.filter(
      (m) => m.status === WorkspaceMemberStatus.ACTIVE && m.userId,
    );

    const memberUserIds = activeMembers.map((m) => m.userId);

    const allSubs =
      memberUserIds.length > 0
        ? await this.subRepo.find({
            where: {
              userId: In(memberUserIds),
              status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
            },
          })
        : [];

    const subsByUser = new Map<string, Subscription[]>();
    for (const sub of allSubs) {
      const list = subsByUser.get(sub.userId) || [];
      list.push(sub);
      subsByUser.set(sub.userId, list);
    }

    let totalMonthly = 0;
    let totalSubscriptions = 0;

    const members = activeMembers.map((member) => {
      const subs = subsByUser.get(member.userId) || [];
      const monthlySpend = subs.reduce(
        (sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
        0,
      );
      const yearlySpend = monthlySpend * 12;

      totalMonthly += monthlySpend;
      totalSubscriptions += subs.length;

      const topSubscriptions = [...subs]
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 3)
        .map((s) => ({
          name: s.name,
          amount: Number(s.amount),
          currency: s.currency,
          billingPeriod: s.billingPeriod,
        }));

      return {
        userId: member.userId,
        name: member.user?.name ?? null,
        email: member.user?.email ?? member.inviteEmail ?? null,
        role: member.role,
        monthlySpend: Math.round(monthlySpend * 100) / 100,
        yearlySpend: Math.round(yearlySpend * 100) / 100,
        subscriptionCount: subs.length,
        topSubscriptions,
      };
    });

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      totalYearly: Math.round(totalMonthly * 12 * 100) / 100,
      totalSubscriptions,
      memberCount: activeMembers.length,
      members,
    };
  }
}
