import { Controller, Post, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';

class PushTokenDto {
  @IsString() token: string;
  @IsOptional() @IsString() platform?: 'ios' | 'android';
}

class NotificationSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() daysBefore?: number;
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
    await this.usersService.update(req.user.id, { fcmToken: dto.token } as any);
    return { message: 'Push token registered' };
  }

  /** Mobile reads notification settings from user profile */
  @Get('settings')
  async getSettings(@Request() req) {
    const user = await this.usersService.findById(req.user.id);
    return {
      enabled: user.notificationsEnabled ?? true,
      daysBefore: (user as any).reminderDaysBefore ?? 3,
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
    await this.usersService.update(req.user.id, data);
    return {
      enabled: dto.enabled ?? true,
      daysBefore: dto.daysBefore ?? 3,
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
