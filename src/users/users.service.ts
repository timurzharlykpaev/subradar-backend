import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
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
    // New users get 7-day Pro trial automatically
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const user = this.repo.create({
      ...data,
      plan: 'pro',
      trialUsed: true,
      trialStartDate: new Date(),
      trialEndDate: trialEnd,
    });
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    // Whitelist only known User columns to avoid TypeORM "Property not found" errors
    const ALLOWED_KEYS = new Set([
      'name', 'avatarUrl', 'fcmToken', 'refreshToken', 'magicLinkToken', 'magicLinkExpiry',
      'lemonSqueezyCustomerId', 'plan', 'trialUsed', 'trialStartDate', 'trialEndDate',
      'aiRequestsUsed', 'aiRequestsMonth', 'proInviteeEmail', 'isActive',
      'timezone', 'locale', 'country', 'defaultCurrency', 'dateFormat',
      'onboardingCompleted', 'notificationsEnabled', 'emailNotifications',
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
    await this.repo.update(id, { refreshToken: token ?? undefined });
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

  async deleteAccount(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
