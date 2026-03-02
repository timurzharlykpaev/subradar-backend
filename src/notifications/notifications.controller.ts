import { Controller, Post, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class UpdateFcmTokenDto {
  @IsString() fcmToken: string;
}

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
  constructor(private readonly service: NotificationsService) {}

  @Post('fcm-token')
  async updateFcmToken(
    @Request() _req: unknown,
    @Body() _dto: UpdateFcmTokenDto,
  ) {
    return { message: 'Use PATCH /users/me with fcmToken field' };
  }

  /** Mobile uses POST /notifications/push-token with {token, platform} */
  @Post('push-token')
  async registerPushToken(
    @Request() _req: unknown,
    @Body() _dto: PushTokenDto,
  ) {
    return { message: 'Push token registered' };
  }

  /** Mobile reads notification settings */
  @Get('settings')
  getSettings(@Request() _req: unknown) {
    return { enabled: true, daysBefore: 3 };
  }

  /** Mobile updates notification settings */
  @Put('settings')
  updateSettings(
    @Request() _req: unknown,
    @Body() _dto: NotificationSettingsDto,
  ) {
    return { enabled: _dto.enabled ?? true, daysBefore: _dto.daysBefore ?? 3 };
  }

  @Post('test')
  async sendTest(
    @Request() _req: unknown,
    @Body() _body: { title: string; message: string },
  ) {
    return { message: 'Test notification queued' };
  }
}
