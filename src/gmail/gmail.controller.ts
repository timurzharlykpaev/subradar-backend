import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireProGuard } from '../auth/guards/require-pro.guard';
import { GmailService } from './gmail.service';
import { GmailScanService } from './gmail-scan.service';

class ScanGmailDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  // When true, bypass the 10-min result cache and run a real scan.
  // Used by the mobile "Scan again" CTA after the user reviews a
  // cached result and wants to look for fresh receipts. The
  // single-flight Redis lock + per-user daily quota still apply.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

function ctxFromReq(req: any): { ipAddress?: string; userAgent?: string } {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  const ipAddress = xff || req?.ip || req?.connection?.remoteAddress || undefined;
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 500) || undefined;
  return { ipAddress, userAgent };
}

@ApiTags('gmail')
@Controller('gmail')
export class GmailController {
  constructor(
    private readonly gmailService: GmailService,
    private readonly scanService: GmailScanService,
  ) {}

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
   *
   * Redirect target is the mobile deep link (`subradar://settings/gmail`)
   * by default, because the only consumer of this flow today is the
   * mobile app and `expo-web-browser`'s `openAuthSessionAsync` listens
   * for that scheme to know when to close the in-app browser. The
   * earlier `https://app.subradar.ai/settings/gmail` target was a 404
   * because no web route exists at that path and the Universal Links
   * AASA only covers `/app/*`. When a web flow lands, override with
   * `GMAIL_REDIRECT_FRONTEND` (e.g. `https://app.subradar.ai/app/gmail`)
   * — the AASA already routes `/app/*` to the mobile binary too, so
   * the same value works for both clients.
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
      process.env.GMAIL_REDIRECT_FRONTEND || 'subradar://settings/gmail';
    const sep = frontendUrl.includes('?') ? '&' : '?';
    if (error) {
      // User denied access on Google's consent screen, or Google
      // returned an error. Bounce back without a result.
      res.redirect(
        `${frontendUrl}${sep}status=denied&error=${encodeURIComponent(error)}`,
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
        `${frontendUrl}${sep}status=connected&email=${encodeURIComponent(result.gmailEmail)}`,
      );
    } catch (err: any) {
      res.redirect(
        `${frontendUrl}${sep}status=error&message=${encodeURIComponent(err?.message ?? 'unknown')}`,
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

  /**
   * Pro/Team-gated bulk scan. Reads up to 200 receipts from the last 90
   * days, parses them through the AI, returns deduplicated subscription
   * candidates. The mobile client then surfaces these in a "Review &
   * import" sheet so the user picks which to add — no auto-import to
   * keep the user in control. Throttled 1/min per user (the in-service
   * Redis lock provides the actual single-flight enforcement; the
   * decorator throttle is belt-and-suspenders).
   */
  @Post('scan')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RequireProGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  async scan(@Request() req, @Body() dto: ScanGmailDto) {
    // RequireProGuard stashed the resolved access on req so we don't
    // re-roundtrip BillingService just to pick the daily-quota tier.
    // Default to 'pro' if for any reason it wasn't populated — keeps the
    // call safe rather than throwing on a missing field.
    const plan: 'pro' | 'organization' =
      req.proAccess?.plan === 'organization' ? 'organization' : 'pro';
    return this.scanService.scan(req.user.id, plan, dto.locale ?? 'en', {
      ...ctxFromReq(req),
      force: dto.force === true,
    });
  }
}
