import { Controller, Post, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';
import { SUPPORTED_PUSH_LOCALES } from './push-i18n';

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

  @Post('test')
  async sendTest(
    @Request() req,
    @Body() body: { title: string; message: string },
  ) {
    const user = await this.usersService.findById(req.user.id);
    if (user.fcmToken) {
      await this.service.sendPushNotification(user.fcmToken, body.title, body.message);
    }
    return { message: 'Test notification sent' };
  }
}
