import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserBilling } from '../billing/entities/user-billing.entity';
import { AuditService } from '../common/audit/audit.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(UserBilling)
    private readonly billingRepo: Repository<UserBilling>,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.billing', 'billing')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Find user by magic-link token. Supports both the new sha256 hash format
   * and the legacy JWT stored directly. Used during magic-link verification.
   */
  async findByMagicLinkToken(tokenOrHash: string): Promise<User | null> {
    return this.repo.findOne({ where: { magicLinkToken: tokenOrHash } });
  }

  async create(data: Partial<User>): Promise<User> {
    // New users start on Free plan — trial is offered later via TrialOfferModal.
    // billing fields are owned by `user_billing`; create both rows in a single
    // transaction so the User row never exists without its billing snapshot.
    return this.repo.manager.transaction(async (m) => {
      const user = m.create(User, { ...data, trialUsed: false });
      await m.save(user);
      await m.insert(UserBilling, {
        userId: user.id,
        plan: 'free',
        billingStatus: 'free',
        cancelAtPeriodEnd: false,
      });
      // Re-load with the eager `billing` relation populated so callers can
      // immediately read `user.plan` etc. without an extra round-trip.
      const reloaded = await m.findOne(User, { where: { id: user.id } });
      return reloaded ?? user;
    });
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    // Whitelist only known User columns to avoid TypeORM "Property not found" errors.
    //
    // The 10 billing fields owned by the state machine are intentionally
    // NOT listed here — they live behind `UserBillingRepository.applyTransition`
    // and any direct write would be silently dropped by this whitelist.
    // The fields are: plan, billingStatus, billingSource, billingPeriod,
    // currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd,
    // gracePeriodEnd, gracePeriodReason, billingIssueAt.
    const ALLOWED_KEYS = new Set([
      'name', 'avatarUrl', 'fcmToken', 'refreshToken', 'refreshTokenIssuedAt',
      'magicLinkToken', 'magicLinkExpiry',
      'lemonSqueezyCustomerId',
      'trialUsed', 'trialStartDate', 'trialEndDate',
      'aiRequestsUsed', 'aiRequestsMonth', 'proInviteeEmail', 'invitedByUserId', 'isActive',
      'timezone', 'locale', 'country', 'defaultCurrency', 'dateFormat',
      'onboardingCompleted', 'notificationsEnabled', 'emailNotifications', 'reminderDaysBefore',
      'weeklyDigestEnabled', 'weeklyDigestSentAt',
      'status', 'downgradedAt',
    ]);
    const safe: Partial<User> = {};
    for (const [k, v] of Object.entries(data)) {
      if (ALLOWED_KEYS.has(k)) (safe as any)[k] = v;
    }
    if (Object.keys(safe).length > 0) {
      await this.repo.update(id, safe);
    }
    return this.findById(id);
  }

  async updateFcmToken(id: string, fcmToken: string): Promise<void> {
    await this.repo.update(id, { fcmToken });
  }

  async updateRefreshToken(id: string, token: string | null): Promise<void> {
    // bcrypt rounds 12 — matches password hashing elsewhere (see AuthService.register).
    // Keeping rounds consistent across the app prevents the refresh-token column
    // from being the weakest link if the DB ever leaks.
    const hashed = token ? await bcrypt.hash(token, 12) : null;
    // Track issuance time so we can enforce absolute expiry in AuthService.refresh
    // even if the JWT's own `exp` claim is tampered with.
    await this.repo.update(id, {
      refreshToken: hashed as any,
      refreshTokenIssuedAt: token ? new Date() : (null as any),
    });
  }

  async updatePreferences(
    id: string,
    prefs: Partial<{
      timezone: string;
      locale: string;
      dateFormat: string;
      notificationsEnabled: boolean;
      currency: string;
      country: string;
    }>,
  ): Promise<User> {
    const updateData: Partial<User> = {};
    if (prefs.timezone !== undefined) updateData.timezone = prefs.timezone;
    if (prefs.locale !== undefined) updateData.locale = prefs.locale;
    if (prefs.dateFormat !== undefined) updateData.dateFormat = prefs.dateFormat;
    if (prefs.notificationsEnabled !== undefined)
      updateData.notificationsEnabled = prefs.notificationsEnabled;
    if (prefs.currency !== undefined) updateData.defaultCurrency = prefs.currency;
    if (prefs.country !== undefined) updateData.country = prefs.country;

    if (Object.keys(updateData).length > 0) {
      await this.repo.update(id, updateData);
    }
    return this.findById(id);
  }

  async save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  /**
   * Delete the RC subscriber record so Apple stops attributing future
   * webhooks to a deleted user. Best-effort: if RC returns 404 (already
   * gone) or the call fails, we continue with the local delete — the
   * user has explicitly asked to delete their data and we shouldn't block
   * on a third-party outage. GDPR / Apple HIG explicitly require us to
   * tell RC to forget the user when we delete the account.
   *
   * Note: this does NOT cancel the underlying Apple subscription — Apple
   * controls IAP cancellation and we have no API for that. The user must
   * cancel via App Store; the in-app delete-account UI should warn them.
   */
  private async deleteRevenueCatSubscriber(userId: string): Promise<void> {
    const apiKey =
      this.cfg.get<string>('REVENUECAT_API_KEY_SECRET', '') ||
      this.cfg.get<string>('REVENUECAT_API_KEY', '');
    if (!apiKey) {
      this.logger.warn(
        `deleteRevenueCatSubscriber: no RC API key — skipping (id=${userId})`,
      );
      // Audit even the no-op so the GDPR right-to-erasure trail is complete.
      await this.audit
        .log({
          userId,
          action: 'rc.subscriber_delete_skipped',
          resourceType: 'user',
          resourceId: userId,
          metadata: { reason: 'rc_api_key_missing' },
        })
        .catch(() => undefined);
      return;
    }
    let status = 0;
    let success = false;
    let error: string | null = null;
    try {
      const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      );
      status = res.status;
      success = res.ok || res.status === 404; // 404 = already gone, treat as ok
      if (res.ok) {
        this.logger.log(`RC subscriber deleted (id=${userId})`);
      } else if (res.status === 404) {
        this.logger.log(
          `RC subscriber already absent (id=${userId}, 404) — skipping`,
        );
      } else {
        const text = await res.text().catch(() => '');
        error = text.slice(0, 200);
        this.logger.warn(
          `RC subscriber delete failed (id=${userId}, status=${res.status}): ${error}`,
        );
      }
    } catch (e: any) {
      error = e?.message ?? String(e);
      this.logger.warn(
        `RC subscriber delete error (id=${userId}): ${error}`,
      );
    }
    // GDPR/Apple HIG: persist the outcome of the third-party erasure
    // attempt so the right-to-erasure audit trail survives even when the
    // RC call failed. The actual local user delete still goes ahead — the
    // user has explicitly asked for their data gone and we shouldn't
    // block on a third-party outage.
    await this.audit
      .log({
        userId,
        action: success
          ? 'rc.subscriber_deleted'
          : 'rc.subscriber_delete_failed',
        resourceType: 'user',
        resourceId: userId,
        metadata: { status, error },
      })
      .catch(() => undefined);
  }

  async deleteAccount(id: string): Promise<void> {
    const em = this.repo.manager;

    // Capture a minimal audit snapshot BEFORE we cascade-delete the row — once
    // `users.delete(id)` returns the identifiers are gone and we can't write a
    // meaningful audit entry after the fact.
    const existing = await this.repo.findOne({ where: { id } }).catch(() => null);
    const snapshot = existing
      ? {
          email: existing.email,
          plan: existing.plan,
          billingSource: existing.billingSource,
          createdAt: existing.createdAt,
        }
      : null;

    // Tell RC to forget this user — required by Apple HIG & GDPR. Best-
    // effort, doesn't block local delete if RC is unreachable.
    if (existing?.billingSource === 'revenuecat') {
      await this.deleteRevenueCatSubscriber(id);
    }

    // Order matters: delete children before parents (workspaces own workspace_members
    // via FK; delete members first, then workspaces). FK-constrained deletes must
    // stay strict, but a few tables (push_tokens, older analysis tables) may not
    // exist on every environment (dev DB was bootstrapped later than prod). For
    // those we tolerate a missing-table error and log, so delete-account doesn't
    // 500 on dev while still surfacing any other failure.
    const strictDelete = async (sql: string) => em.query(sql, [id]);
    const tolerantDelete = async (sql: string, table: string) => {
      try {
        await em.query(sql, [id]);
      } catch (err: any) {
        if (/does not exist/i.test(err?.message ?? '')) {
          this.logger.warn(
            `deleteAccount: table "${table}" absent — skipping (id=${id})`,
          );
          return;
        }
        throw err;
      }
    };

    await strictDelete(`DELETE FROM analysis_jobs WHERE "userId" = $1`);
    await strictDelete(`DELETE FROM analysis_results WHERE "userId" = $1`);
    await strictDelete(`DELETE FROM analysis_usage WHERE "userId" = $1`);
    await strictDelete(`DELETE FROM workspace_members WHERE "userId" = $1`);
    await strictDelete(`DELETE FROM workspaces WHERE "ownerId" = $1`);
    await strictDelete(`DELETE FROM invite_codes WHERE "createdBy" = $1`);
    await strictDelete(`DELETE FROM invite_codes WHERE "usedBy" = $1`);
    await tolerantDelete(
      `DELETE FROM push_tokens WHERE "userId" = $1`,
      'push_tokens',
    );

    // subscriptions, payment_cards, receipts, reports, refresh_tokens → CASCADE
    await this.repo.delete(id);
    this.logger.log(`Account deleted: ${id}`);

    await this.audit.log({
      userId: id,
      action: 'account.delete',
      resourceType: 'user',
      resourceId: id,
      metadata: snapshot ?? undefined,
    });
  }
}
