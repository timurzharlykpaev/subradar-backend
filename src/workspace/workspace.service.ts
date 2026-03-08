import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import {
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from './entities/workspace-member.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import {
  Subscription,
  SubscriptionStatus,
  BillingPeriod,
} from '../subscriptions/entities/subscription.entity';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
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
