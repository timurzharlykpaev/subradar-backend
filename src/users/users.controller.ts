import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Request() req) {
    return this.usersService.findById(req.user.id);
  }

  @Patch('me')
  updateMe(
    @Request() req,
    @Body()
    body: Partial<{ name: string; avatarUrl: string; fcmToken: string }>,
  ) {
    return this.usersService.update(req.user.id, body);
  }

  @Delete('me')
  @HttpCode(200)
  async deleteMe(@Request() req) {
    await this.usersService.deleteAccount(req.user.id);
    return { success: true };
  }

  @Patch('preferences')
  updatePreferences(
    @Request() req,
    @Body()
    body: Partial<{
      timezone: string;
      locale: string;
      dateFormat: string;
      notificationsEnabled: boolean;
      currency: string;
      country: string;
    }>,
  ) {
    return this.usersService.updatePreferences(req.user.id, body);
  }
}
