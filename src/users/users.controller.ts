import {
  Controller,
  Get,
  Header,
  Patch,
  Delete,
  Body,
  UseGuards,
  Request,
  HttpCode,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

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

  /**
   * GDPR Article 20 — data portability. Returns the full user data set as
   * a downloadable JSON file. Throttled tightly because building the export
   * touches several large tables (subscriptions, receipts, reports) and a
   * malicious client could otherwise hammer it.
   */
  @Get('me/export')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async exportMe(@Request() req, @Res() res: Response) {
    const data = await this.usersService.exportUserData(req.user.id);
    const filename = `subradar-export-${req.user.id}-${Date.now()}.json`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.json(data);
  }

  // Use UpdateUserDto (class-validator) instead of an inline TS type so the
  // global ValidationPipe actually validates each field — previously the
  // inline `Partial<{...}>` had no metatype, so class-validator was
  // bypassed entirely and any string slipped through: a typo like
  // "USDT" landed in `displayCurrency` and a malformed "kazakh" went
  // into `region`, then later renders showed broken totals because the
  // currency code couldn't be looked up. The DTO enforces ISO-3166
  // alpha-2 for region and ISO-4217 for displayCurrency, with @Transform
  // up-casing the values before the regex check so client-side
  // lowercase doesn't 400.
  @Patch('me')
  updateMe(@Request() req, @Body() body: UpdateUserDto) {
    const payload: Record<string, any> = { ...body };
    if (typeof payload.locale === 'string') {
      // Normalize "ru-RU" → "ru" so cron-side resolvePushLocale stays cheap.
      payload.locale = payload.locale.split(/[-_]/)[0].toLowerCase();
    }
    return this.usersService.update(req.user.id, payload);
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
