import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { REDIS_CLIENT } from '../common/redis.module';
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
import { UsersService } from '../users/users.service';
import { AuditService } from '../common/audit/audit.service';
import { OutboxService } from '../billing/outbox/outbox.service';
import { UserBillingRepository } from '../billing/user-billing.repository';
import { FxService } from '../fx/fx.service';
import { AnalysisService } from '../analysis/analysis.service';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
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
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly userBilling: UserBillingRepository,
    private readonly fxService: FxService,
    private readonly analysisService: AnalysisService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

    await this.audit.log({
      userId: ownerId,
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: saved.id,
      metadata: { name: saved.name, maxMembers: saved.maxMembers },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.created',
      userId: ownerId,
      properties: { workspaceId: saved.id, name: saved.name },
    });

    // Return with members relation loaded
    return this.findById(saved.id);
  }

  async findById(id: string): Promise<Workspace> {
    const ws = await this.workspaceRepo.findOne({
      where: { id },
      // 'members.user.billing' is required because TypeORM does NOT
      // recursively apply eager-relations on nested join targets — a
      // User loaded as `members.user` would otherwise have
      // `user.billing === undefined`, which silently makes
      // getWorkspaceAnalytics report every member as `hasOwnPro: false`.
      relations: ['members', 'members.user', 'members.user.billing'],
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
      relations: ['members', 'members.user', 'members.user.billing'],
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
    const savedMember = await this.memberRepo.save(member);

    await this.audit.log({
      userId: requesterId,
      action: 'workspace.member_invited',
      resourceType: 'workspace_member',
      resourceId: savedMember.id,
      metadata: {
        workspaceId,
        email: dto.email,
        role: savedMember.role,
      },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.member_invited',
      userId: requesterId,
      properties: {
        workspaceId,
        memberId: savedMember.id,
        email: dto.email,
        role: savedMember.role,
      },
    });

    return savedMember;
  }

  async removeMember(
    workspaceId: string,
    requesterId: string,
    memberId: string,
  ): Promise<void> {
    const workspace = await this.findById(workspaceId);
    if (workspace.ownerId !== requesterId)
      throw new ForbiddenException('Only owner can remove members');

    // Find member before deleting to get userId for grace period
    const member = await this.memberRepo.findOne({ where: { id: memberId, workspaceId } });
    await this.memberRepo.delete({ id: memberId, workspaceId });

    if (member?.userId) {
      // Removed-from-team: if the user has no own RC sub (or it's
      // already cancel_at_period_end), give them a 7-day grace via the
      // state machine. The TEAM_MEMBER_REMOVED transition is a no-op
      // when the user has their own active RC sub.
      await this.userBilling.applyTransition(
        member.userId,
        { type: 'TEAM_MEMBER_REMOVED' },
        { actor: 'admin_grant' },
      );
    }

    await this.audit.log({
      userId: requesterId,
      action: 'workspace.member_removed',
      resourceType: 'workspace_member',
      resourceId: memberId,
      metadata: {
        workspaceId,
        removedUserId: member?.userId ?? null,
        removedEmail: member?.inviteEmail ?? null,
        role: member?.role ?? null,
      },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.member_removed',
      userId: requesterId,
      properties: {
        workspaceId,
        memberId,
        removedUserId: member?.userId ?? null,
      },
    });
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

    // Generate unique 10-char code
    let code: string;
    let attempts = 0;
    do {
      code = Array.from(
        { length: 10 },
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
    const savedCode = await this.inviteCodeRepo.save(inviteCode);

    await this.audit.log({
      userId: requesterId,
      action: 'workspace.invite_code_generated',
      resourceType: 'invite_code',
      resourceId: savedCode.id,
      metadata: {
        workspaceId,
        expiresAt: savedCode.expiresAt,
      },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.invite_code_generated',
      userId: requesterId,
      properties: {
        workspaceId,
        inviteCodeId: savedCode.id,
      },
    });

    return { code: savedCode.code, expiresAt: savedCode.expiresAt };
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
    const savedMember = await this.memberRepo.save(member);

    this.logger.log(`Member joined workspace: userId=${userId} workspaceId=${workspace.id} via invite code`);

    await this.audit.log({
      userId,
      action: 'workspace.member_joined',
      resourceType: 'workspace_member',
      resourceId: savedMember.id,
      metadata: {
        workspaceId: workspace.id,
        inviteCodeId: inviteCode.id,
      },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.member_joined',
      userId,
      properties: {
        workspaceId: workspace.id,
        memberId: savedMember.id,
        via: 'invite_code',
      },
    });

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
    this.logger.log(`Member left workspace: userId=${userId} workspaceId=${workspaceId}`);

    await this.userBilling.applyTransition(
      userId,
      { type: 'TEAM_MEMBER_REMOVED' },
      { actor: 'admin_grant' },
    );
  }

  /** Owner/Admin can view any member's subscriptions within the workspace */
  async getMemberSubscriptions(workspaceId: string, requesterId: string, memberId: string): Promise<Subscription[]> {
    // Try finding workspace by ID first, fallback to user's workspace
    let workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members', 'members.user'],
    });
    // If workspace not found by UUID, user might have passed wrong ID — try their workspace
    if (!workspace) {
      workspace = await this.getMyWorkspace(requesterId);
    }
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (!requester) {
      this.logger.warn(`getMemberSubscriptions: requester ${requesterId} not in workspace ${workspace.id}, members: ${workspace.members.map(m => m.userId).join(',')}`);
      throw new ForbiddenException('Not a member of this workspace');
    }
    if (requester.role !== WorkspaceMemberRole.OWNER && requester.role !== WorkspaceMemberRole.ADMIN) {
      throw new ForbiddenException('Only owner or admin can view member subscriptions');
    }
    const target = workspace.members.find((m) => m.id === memberId || m.userId === memberId);
    if (!target) throw new NotFoundException('Member not found in workspace');

    return this.subRepo.find({
      where: { userId: target.userId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
      order: { amount: 'DESC' },
    });
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

    const workspaceName = workspace.name;

    await this.inviteCodeRepo.delete({ workspaceId });
    await this.memberRepo.delete({ workspaceId });
    await this.workspaceRepo.remove(workspace);
    this.logger.log(`Workspace deleted: ${workspaceId} by owner ${requesterId}`);

    await this.audit.log({
      userId: requesterId,
      action: 'workspace.deleted',
      resourceType: 'workspace',
      resourceId: workspaceId,
      metadata: { name: workspaceName },
    });
    await this.outbox.enqueue('amplitude.track', {
      event: 'workspace.deleted',
      userId: requesterId,
      properties: { workspaceId, name: workspaceName },
    });
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

  async getWorkspaceAnalytics(userId: string, displayCurrencyOverride?: string) {
    const workspace = await this.getMyWorkspace(userId);
    if (!workspace) throw new NotFoundException('Workspace not found');

    // Display currency resolution priority:
    //   1. explicit `?displayCurrency=` query param from the client (lets the
    //      mobile UI render in whatever the user just picked, even before
    //      their backend `users.displayCurrency` row catches up — fixes the
    //      stale-USD bug seen on KZT switches)
    //   2. requesting user's persisted preference
    //   3. USD fallback
    // Cache key includes the resolved currency so each variant stays warm
    // independently (5-min TTL).
    const requesting = await this.usersService.findById(userId);
    const overrideUpper = (displayCurrencyOverride || '').trim().toUpperCase();
    // Defend against junk input — only honour an ISO-4217-shaped 3-letter code.
    const validOverride = /^[A-Z]{3}$/.test(overrideUpper) ? overrideUpper : null;
    const displayCurrency =
      validOverride || (requesting?.displayCurrency as string) || 'USD';

    const cacheKey = `ws:${workspace.id}:analytics:${displayCurrency}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed;
      }
    } catch (e: any) {
      // Cache read failure is never fatal — fall through to DB.
      this.logger.debug(`analytics cache read failed: ${e?.message}`);
    }

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

    // FX rates fetched ONCE for the whole computation. Failures fall
    // back to "no conversion" — same contract the reports module uses,
    // so a broken FX provider can't take the analytics endpoint down.
    let rates: Record<string, number> = {};
    let fxFailed = false;
    try {
      const fx = await this.fxService.getRates();
      rates = fx.rates;
    } catch (e: any) {
      this.logger.warn(`FX fetch failed in workspace analytics: ${e?.message}`);
      fxFailed = true;
    }

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
      const monthlySpend = subs.reduce((sum, s) => {
        const monthlyRaw = this.toMonthlyAmount(Number(s.amount), s.billingPeriod);
        // Convert each sub from its currency into the owner's display
        // currency. Without this, a USD sub + RUB sub silently summed
        // raw numbers and produced nonsense totals on mixed teams.
        const converted = this.convertSafe(monthlyRaw, s.currency, displayCurrency, rates);
        return sum + converted;
      }, 0);
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

      const u = member.user;
      const hasOwnPro = !!(u && u.billingSource === 'revenuecat' && !u.cancelAtPeriodEnd);
      const gracePeriodEnd = u?.gracePeriodEnd ?? null;
      return {
        userId: member.userId,
        name: u?.name ?? null,
        email: u?.email ?? member.inviteEmail ?? null,
        role: member.role,
        monthlySpend: Math.round(monthlySpend * 100) / 100,
        yearlySpend: Math.round(yearlySpend * 100) / 100,
        subscriptionCount: subs.length,
        topSubscriptions,
        hasOwnPro,
        gracePeriodEnd: gracePeriodEnd ? new Date(gracePeriodEnd).toISOString() : null,
      };
    });

    const result = {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      totalYearly: Math.round(totalMonthly * 12 * 100) / 100,
      totalSubscriptions,
      memberCount: activeMembers.length,
      displayCurrency,
      fxFailed,
      members,
    };

    // Don't cache when FX failed — totals are misleading (mixed
    // currencies summed as raw numbers). Skipping the SETEX lets the
    // next call try again with a hopefully-recovered FX provider
    // instead of serving wrong-but-fast data for 5 minutes.
    if (!fxFailed) {
      try {
        await this.redis.setex(cacheKey, 300, JSON.stringify(result));
      } catch (e: any) {
        this.logger.debug(`analytics cache write failed: ${e?.message}`);
      }
    }
    return result;
  }

  /**
   * Invalidate the cached analytics blobs for every currency variant
   * of a workspace. Called on subscription / membership changes so the
   * next read recomputes. Uses SCAN (not KEYS) so we don't block Redis
   * on large keyspaces.
   */
  async invalidateAnalyticsCache(workspaceId: string): Promise<void> {
    try {
      const stream = this.redis.scanStream({
        match: `ws:${workspaceId}:analytics:*`,
        count: 50,
      });
      const keys: string[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (batch: string[]) => keys.push(...batch));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (e: any) {
      this.logger.debug(`analytics cache invalidate failed: ${e?.message}`);
    }
  }

  /**
   * FX-safe convert. If we have rates and the sub's currency isn't
   * the target, route through FxService; otherwise return the raw
   * amount (best-effort under partial outage — better than zeroing
   * the row, which would silently lose data on an FX failure).
   */
  private convertSafe(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    rates: Record<string, number>,
  ): number {
    if (fromCurrency === toCurrency) return amount;
    if (Object.keys(rates).length === 0) return amount; // FX outage — keep raw
    try {
      return this.fxService
        .convert(new Decimal(amount), fromCurrency, toCurrency, rates)
        .toNumber();
    } catch {
      return amount;
    }
  }

  /**
   * Owner-only paginated members list. Used by mobile Reports / team
   * overview so the screen can render large teams (50+ members)
   * without OOM-ing on a single inline `members[]` blob.
   */
  async listMembersPaginated(
    workspaceId: string,
    requesterId: string,
    opts: { page: number; limit: number; sort: 'spend' | 'name' | 'role' },
  ) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members', 'members.user'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const requester = workspace.members.find((m) => m.userId === requesterId);
    if (!requester) throw new ForbiddenException('Not a member of this workspace');
    if (
      requester.role !== WorkspaceMemberRole.OWNER &&
      requester.role !== WorkspaceMemberRole.ADMIN
    ) {
      throw new ForbiddenException('Only owner or admin can list members');
    }

    const activeMembers = workspace.members.filter(
      (m) => m.status === WorkspaceMemberStatus.ACTIVE && m.userId,
    );
    const memberUserIds = activeMembers.map((m) => m.userId);

    // Sub counts via groupBy in a single query — no N+1 even on a 500-
    // member team.
    const subAggRows: Array<{ userId: string; count: string; spend: string }> =
      memberUserIds.length > 0
        ? await this.subRepo
            .createQueryBuilder('s')
            .select('s."userId"', 'userId')
            .addSelect('COUNT(*)', 'count')
            .addSelect('SUM(CAST(s.amount AS NUMERIC))', 'spend')
            .where('s."userId" IN (:...ids)', { ids: memberUserIds })
            .andWhere('s.status IN (:...statuses)', {
              statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
            })
            .groupBy('s."userId"')
            .getRawMany()
        : [];

    const aggByUser = new Map<string, { count: number; spend: number }>();
    for (const row of subAggRows) {
      aggByUser.set(row.userId, {
        count: Number(row.count) || 0,
        spend: Number(row.spend) || 0,
      });
    }

    const enriched = activeMembers.map((m) => {
      const agg = aggByUser.get(m.userId) || { count: 0, spend: 0 };
      return {
        memberId: m.id,
        userId: m.userId,
        name: m.user?.name ?? null,
        email: m.user?.email ?? m.inviteEmail ?? null,
        role: m.role,
        subscriptionCount: agg.count,
        // raw spend (mixed currencies) — kept as a sort key only.
        // The Reports screen renders converted totals from analytics.
        rawSpend: agg.spend,
      };
    });

    // Sort
    if (opts.sort === 'name') {
      enriched.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (opts.sort === 'role') {
      const roleOrder = { OWNER: 0, ADMIN: 1, MEMBER: 2 } as const;
      enriched.sort(
        (a, b) =>
          (roleOrder[a.role as keyof typeof roleOrder] ?? 3) -
          (roleOrder[b.role as keyof typeof roleOrder] ?? 3),
      );
    } else {
      enriched.sort((a, b) => b.rawSpend - a.rawSpend);
    }

    const total = enriched.length;
    const start = (opts.page - 1) * opts.limit;
    const items = enriched.slice(start, start + opts.limit);
    return {
      pagination: { page: opts.page, limit: opts.limit, total, hasMore: start + items.length < total },
      members: items,
    };
  }

  /**
   * Owner-only — pull team-overlap data from the latest cached AI
   * analysis. No fresh OpenAI call; if there's no analysis yet, the
   * owner's first call should hit POST /workspace/me/analysis/run.
   */
  async getTeamOverlaps(workspaceId: string, requesterId: string) {
    const workspace = await this.workspaceRepo.findOne({
      where: { id: workspaceId },
      relations: ['members'],
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.ownerId !== requesterId) {
      throw new ForbiddenException('Only the workspace owner can view team overlaps');
    }
    const latest = await this.analysisService.getLatest(requesterId, workspace.id);
    const result = (latest as any)?.latestResult;
    const overlaps = Array.isArray(result?.overlaps) ? result.overlaps : [];
    const teamSavings = Number(result?.teamSavings) || 0;
    return {
      workspaceId: workspace.id,
      overlaps,
      potentialSavingsMonthly: teamSavings,
      lastAnalysisAt: result?.createdAt ?? null,
    };
  }
}
