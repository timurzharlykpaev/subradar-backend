import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
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
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async create(data: Partial<User>): Promise<User> {
    // New users start on Free plan — trial is offered later via TrialOfferModal
    const user = this.repo.create({
      ...data,
      plan: 'free',
      trialUsed: false,
    });
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    // Whitelist only known User columns to avoid TypeORM "Property not found" errors
    const ALLOWED_KEYS = new Set([
      'name', 'avatarUrl', 'fcmToken', 'refreshToken', 'magicLinkToken', 'magicLinkExpiry',
      'lemonSqueezyCustomerId', 'plan', 'billingSource', 'billingPeriod', 'trialUsed', 'trialStartDate', 'trialEndDate',
      'aiRequestsUsed', 'aiRequestsMonth', 'proInviteeEmail', 'isActive',
      'timezone', 'locale', 'country', 'defaultCurrency', 'dateFormat',
      'onboardingCompleted', 'notificationsEnabled', 'emailNotifications', 'reminderDaysBefore', 'weeklyDigestEnabled',
      'cancelAtPeriodEnd', 'currentPeriodEnd', 'status', 'downgradedAt',
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
    const hashed = token ? await bcrypt.hash(token, 10) : undefined;
    await this.repo.update(id, { refreshToken: hashed });
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

  async deleteAccount(id: string): Promise<void> {
    const em = this.repo.manager;

    // Delete related data that doesn't have onDelete: CASCADE
    // Use try/catch per table in case some don't exist yet
    const tables = [
      `DELETE FROM analysis_jobs WHERE "userId" = $1`,
      `DELETE FROM analysis_results WHERE "userId" = $1`,
      `DELETE FROM analysis_usage WHERE "userId" = $1`,
      `DELETE FROM workspace_members WHERE "userId" = $1`,
      `DELETE FROM workspaces WHERE "ownerId" = $1`,
      `DELETE FROM invite_codes WHERE "createdBy" = $1`,
      `DELETE FROM invite_codes WHERE "usedBy" = $1`,
    ];
    for (const sql of tables) {
      try { await em.query(sql, [id]); } catch (e) {
        this.logger.warn(`deleteAccount cleanup skipped: ${e.message?.split('\n')[0]}`);
      }
    }

    // subscriptions, payment_cards, receipts, reports, refresh_tokens → CASCADE
    await this.repo.delete(id);
    this.logger.log(`Account deleted: ${id}`);
  }
}
