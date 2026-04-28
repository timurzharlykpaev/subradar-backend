import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';
import { SUPPORTED_PUSH_LOCALES, pushT } from './push-i18n';

class PushTokenDto {
  @IsString() token: string;
  @IsOptional() @IsString() platform?: 'ios' | 'android';
  /**
   * Optional BCP-47-ish locale code (en, ru, ru-RU). When provided we update
   * user.locale so cron-driven push messages render in the right language.
   * Unknown codes are silently ignored on save (validation is loose to keep
   * old clients shipping unknown tags from breaking the registration).
   */
  @IsOptional()
  @IsString()
  locale?: string;
}

class NotificationSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() daysBefore?: number;
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
  @IsOptional() @IsBoolean() weeklyDigestEnabled?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  /** Mobile sends native FCM/APNs token via POST /notifications/push-token */
  @Post('push-token')
  async registerPushToken(
    @Request() req,
    @Body() dto: PushTokenDto,
  ) {
    const update: Record<string, unknown> = { fcmToken: dto.token };
    if (dto.locale) {
      const lang = dto.locale.split(/[-_]/)[0].toLowerCase();
      if ((SUPPORTED_PUSH_LOCALES as readonly string[]).includes(lang)) {
        update.locale = lang;
      }
    }
    await this.usersService.update(req.user.id, update as any);
    return { message: 'Push token registered' };
  }

  /** Mobile reads notification settings from user profile */
  @Get('settings')
  async getSettings(@Request() req) {
    const user = await this.usersService.findById(req.user.id);
    return {
      enabled: user.notificationsEnabled ?? true,
      daysBefore: (user as any).reminderDaysBefore ?? 3,
      emailNotifications: user.emailNotifications ?? true,
      weeklyDigestEnabled: user.weeklyDigestEnabled ?? true,
    };
  }

  /** Mobile updates notification settings */
  @Put('settings')
  async updateSettings(
    @Request() req,
    @Body() dto: NotificationSettingsDto,
  ) {
    const data: any = {};
    if (dto.enabled !== undefined) data.notificationsEnabled = dto.enabled;
    if (dto.daysBefore !== undefined) data.reminderDaysBefore = dto.daysBefore;
    if (dto.emailNotifications !== undefined) data.emailNotifications = dto.emailNotifications;
    if (dto.weeklyDigestEnabled !== undefined) data.weeklyDigestEnabled = dto.weeklyDigestEnabled;
    await this.usersService.update(req.user.id, data);

    const user = await this.usersService.findById(req.user.id);
    return {
      enabled: user.notificationsEnabled ?? true,
      daysBefore: user.reminderDaysBefore ?? 3,
      emailNotifications: user.emailNotifications ?? true,
      weeklyDigestEnabled: user.weeklyDigestEnabled ?? true,
    };
  }

  /**
   * Developer / debugging affordance — fires a localized test push to the
   * caller's stored FCM token. The mobile dev-mode panel calls this so
   * users can verify push permissions and tap-to-open behaviour without
   * waiting for a real reminder cron tick.
   *
   * Throttled to 5/min to keep abuse off Apple/Google quota.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('test')
  async sendTest(@Request() req) {
    const user = await this.usersService.findById(req.user.id);
    if (!user.fcmToken) {
      throw new HttpException(
        'No push token registered for this account. Open the app on a device where push permission was granted.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const t = pushT(user.locale);
    // Reuse the paymentReminder copy — it's the most common channel a user
    // wants to verify and already exists in all 10 locales.
    const { title, body } = t.paymentReminder({
      name: 'SubRadar',
      amount: 0,
      currency: '',
      daysLeft: 1,
      dateStr: new Date().toISOString().slice(0, 10),
    });
    await this.service.sendPushNotification(user.fcmToken, title, body, {
      type: 'test',
      screen: '/(tabs)/settings',
    });
    return { message: 'Test notification sent', token: user.fcmToken.slice(0, 12) + '…' };
  }
}
