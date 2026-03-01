import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class UpdateFcmTokenDto {
  @IsString() fcmToken: string;
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
    // Will be handled by UsersController /me PATCH
    return { message: 'Use PATCH /users/me with fcmToken field' };
  }

  @Post('test')
  async sendTest(
    @Request() _req: unknown,
    @Body() _body: { title: string; message: string },
  ) {
    return { message: 'Test notification queued' };
  }
}
