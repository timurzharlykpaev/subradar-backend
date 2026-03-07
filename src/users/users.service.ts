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
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    await this.repo.update(id, data);
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
}
