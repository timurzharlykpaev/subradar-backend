import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GmailService } from './gmail.service';

function ctxFromReq(req: any): { ipAddress?: string; userAgent?: string } {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  const ipAddress = xff || req?.ip || req?.connection?.remoteAddress || undefined;
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 500) || undefined;
  return { ipAddress, userAgent };
}

@ApiTags('gmail')
@Controller('gmail')
export class GmailController {
  constructor(private readonly gmailService: GmailService) {}

  /**
   * Authenticated initiator: the client posts here to get a Google
   * consent URL (with state HMAC bound to the user). Mobile / web then
   * redirect the user to that URL via in-app browser.
   *
   * We DON'T server-side-redirect from this endpoint because the client
   * needs to know the URL to feed into platform-specific browser APIs
   * (`expo-web-browser`, `chrome-tabs-intent`, etc).
   */
  @Get('connect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  connect(@Request() req): { authUrl: string } {
    return { authUrl: this.gmailService.buildAuthUrl(req.user.id) };
  }

  /**
   * Public — Google redirects the browser here after consent. We extract
   * `code` and `state`, finish the OAuth dance, store the refresh
   * token (encrypted), and bounce the user back to the SubRadar app via
   * a deep link. The state HMAC carries the userId so we don't need a
   * session cookie.
   */
  @Get('callback')
  async callback(
    @Request() req,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const frontendUrl =
      process.env.FRONTEND_URL || 'https://app.subradar.ai';
    if (error) {
      // User denied access on Google's consent screen, or Google
      // returned an error. Bounce back without a result.
      res.redirect(
        `${frontendUrl}/settings/gmail?status=denied&error=${encodeURIComponent(error)}`,
      );
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }
    try {
      const result = await this.gmailService.handleCallback(
        code,
        state,
        ctxFromReq(req),
      );
      res.redirect(
        `${frontendUrl}/settings/gmail?status=connected&email=${encodeURIComponent(result.gmailEmail)}`,
      );
    } catch (err: any) {
      res.redirect(
        `${frontendUrl}/settings/gmail?status=error&message=${encodeURIComponent(err?.message ?? 'unknown')}`,
      );
    }
  }

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  status(@Request() req) {
    return this.gmailService.getStatus(req.user.id);
  }

  @Delete('disconnect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  disconnect(@Request() req) {
    return this.gmailService.disconnect(req.user.id, ctxFromReq(req));
  }
}
