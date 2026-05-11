import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
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
import { BillingService } from '../billing/billing.service';
import { UsersService } from '../users/users.service';

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
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
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
  async status(@Request() req) {
    // Base Gmail connection state (everyone — Free can connect Gmail
    // even though they can't scan, so the disconnect button still
    // works regardless of plan).
    const base = await this.gmailService.getStatus(req.user.id);
    // Tack on the per-plan daily scan budget so the mobile UI can
    // render an honest "0 / 1 scans left today" pill + disable the
    // Scan button preemptively when the cap is hit. Additive change —
    // old mobile clients ignore the extra field. Free users (and any
    // unrecognised plan) get `dailyScans: null` to keep the field
    // semantically meaningful ("no scan budget applies").
    let dailyScans: { used: number; cap: number; resetAt: string } | null =
      null;
    try {
      const user = await this.usersService.findById(req.user.id);
      if (user) {
        const access = await this.billingService.getEffectiveAccess(user);
        if (access.plan === 'pro' || access.plan === 'organization') {
          dailyScans = await this.scanService.getDailyQuotaUsage(
            req.user.id,
            access.plan,
          );
        }
      }
    } catch {
      /* dailyScans stays null — never fail the status read on a
         billing or Redis hiccup; the user can still see connection
         state and the Scan endpoint will surface the real 429 if any */
    }
    return { ...base, dailyScans };
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

  /**
   * Async / job-based scan. Returns immediately with a jobId; the
   * mobile client polls /scan/status/:jobId for the result or
   * receives a push notification when the scan completes. Designed
   * for the "user backgrounded the app mid-scan" case where the
   * old sync endpoint would lose the result the moment the HTTP
   * connection drops.
   *
   * Reuses an in-flight job if one already exists for this user
   * (double-tap, re-foreground retry) — never starts two scans in
   * parallel for the same user.
   */
  @Post('scan/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RequireProGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  async scanStart(@Request() req, @Body() dto: ScanGmailDto) {
    const plan: 'pro' | 'organization' =
      req.proAccess?.plan === 'organization' ? 'organization' : 'pro';
    return this.scanService.startScanJob(
      req.user.id,
      plan,
      dto.locale ?? 'en',
      { ...ctxFromReq(req), force: dto.force === true },
    );
  }

  /**
   * Poll for a job's current state. Returns 404 when the job ID is
   * unknown OR belongs to a different user — exposing presence-
   * information for arbitrary IDs would let a curious tenant probe
   * for in-flight scans on other accounts. Same 404 for both cases
   * by design.
   */
  @Get('scan/status/:jobId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async scanStatus(@Request() req, @Param('jobId') jobId: string) {
    const status = await this.scanService.getScanJobStatus(jobId, req.user.id);
    if (!status) {
      throw new NotFoundException('Job not found');
    }
    return status;
  }
}
