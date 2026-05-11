import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  Req,
  UseGuards,
  Request,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';
import { EffectiveAccessResolver } from './effective-access/effective-access.service';
import { BillingMeResponse } from './effective-access/billing-me.types';
import { PLANS } from './plans.config';
import { TrialsService } from './trials/trials.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

class CreateCheckoutDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() billing?: 'monthly' | 'yearly';
}

class SyncRevenueCatDto {
  @IsString()
  @IsNotEmpty()
  productId: string;
}

class InviteDto {
  @IsEmail() email: string;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
    private readonly effective: EffectiveAccessResolver,
    private readonly trials: TrialsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @SkipThrottle()
  @Post('revenuecat-webhook')
  async revenuecatWebhook(
    @Headers('authorization') authorization: string,
    @Body() body: any,
  ) {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret || !authorization) {
      throw new BadRequestException('Invalid webhook authorization');
    }

    // Always compare the bare token value (strip Bearer prefix if present)
    const incoming = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;
    const incomingBuf = Buffer.from(incoming);
    const secretBuf = Buffer.from(secret);
    if (incomingBuf.length !== secretBuf.length || !timingSafeEqual(incomingBuf, secretBuf)) {
      throw new BadRequestException('Invalid webhook authorization');
    }
    await this.billingService.handleRevenueCatWebhook(body);
    return { received: true };
  }

  @SkipThrottle()
  @Post('webhook')
  async webhook(
    @Req() req: any,
    @Headers('x-signature') signature: string,
    @Body() body: any,
  ) {
    // Lemon Squeezy signs the EXACT raw bytes of the request body. We must
    // compare against req.rawBody captured by express.json({ verify }) in
    // main.ts — any re-serialization (JSON.stringify) breaks the HMAC.
    if (!req.rawBody) {
      throw new BadRequestException('Raw body missing — webhook body parser is misconfigured');
    }
    const rawBody: string =
      typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8');

    if (!this.billingService.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    await this.billingService.handleLemonSqueezyWebhook(body);
    return { received: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('checkout')
  async createCheckout(@Request() req, @Body() dto: CreateCheckoutDto) {
    // App Store Guideline 3.1.1 forbids any non-IAP purchase path on iOS.
    // The Lemon Squeezy web checkout this endpoint produces is the web
    // app's monetization path; if an iOS client ever calls it (mistakenly
    // or by design) and opens the URL in a WebView/Linking, that's an
    // App Review reject.
    //
    // Detection is header-only (`X-Client-Platform: ios`, sent by the
    // mobile axios client). User-Agent regexes were tempting but fire on
    // iPhone Safari opening the web app, which would 410 a legitimate
    // web checkout. The web client never sets this header.
    const platform = String(req.headers?.['x-client-platform'] ?? '').toLowerCase();
    if (platform === 'ios') {
      throw new HttpException(
        'Web checkout is unavailable on iOS — please subscribe via the in-app purchase.',
        HttpStatus.GONE,
      );
    }
    const user = await this.usersService.findById(req.user.id);
    const variantId = dto.variantId || dto.planId || '';
    return this.billingService.createCheckout(req.user.id, variantId, user.email, dto.billing || 'monthly');
  }

  @Get('plans')
  getPlans() {
    // Values must stay in sync with src/billing/plans.config.ts — the
    // user-facing labels here had drifted (Free was advertising 5
    // subscriptions and 10 AI requests, real caps were 3 and 5).
    // Sourcing the numbers from PLANS keeps the two from diverging
    // silently again.
    const free = PLANS.free;
    const pro = PLANS.pro;
    return [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        currency: 'USD',
        period: null,
        features: [
          {
            key: 'subscriptions',
            value: free.subscriptionLimit,
            label: `Up to ${free.subscriptionLimit} subscriptions`,
          },
          {
            key: 'ai_requests',
            value: free.aiRequestsLimit,
            label: `${free.aiRequestsLimit} AI requests/month`,
          },
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        price: 2.99,
        currency: 'USD',
        period: 'month',
        trialDays: 7,
        variantId: '1377270',
        features: [
          { key: 'subscriptions', value: null, label: 'Unlimited subscriptions' },
          {
            key: 'ai_requests',
            value: pro.aiRequestsLimit,
            label: `${pro.aiRequestsLimit} AI requests/month`,
          },
          { key: 'analytics', value: true, label: 'Advanced analytics' },
          { key: 'invite', value: 1, label: '+1 invite slot' },
        ],
      },
      {
        id: 'organization',
        name: 'Organization',
        price: 9.99,
        currency: 'USD',
        period: 'month',
        variantId: '1377279',
        features: [
          { key: 'subscriptions', value: null, label: 'Unlimited subscriptions' },
          { key: 'ai_requests', value: null, label: 'Unlimited AI requests' },
          { key: 'members', value: null, label: 'Unlimited team members' },
          { key: 'analytics', value: true, label: 'Team analytics' },
          { key: 'reports', value: true, label: 'PDF reports' },
        ],
      },
    ];
  }

  /**
   * Unified billing snapshot consumed by the mobile + web clients.
   *
   * Thin controller on purpose: all plan/state/banner/limits math lives
   * in {@link EffectiveAccessResolver} so this surface and any future
   * caller (admin console, internal scripts) stay perfectly in sync.
   *
   * TODO: Redis cache — wrap resolver call with a short-lived (30–60 s)
   * per-user cache once we have real traffic data to size it by.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getBillingMe(@Request() req): Promise<BillingMeResponse> {
    return this.effective.resolve(req.user.id);
  }

  /**
   * Grant the caller their (one) backend trial. Delegates to
   * {@link TrialsService.activate} which handles the uniqueness lock,
   * audit log and transactional outbox enqueue.
   *
   * Rate-limited to 1 call / minute per account — the global
   * ThrottlerGuard runs per-IP so a second layer here is cheap
   * insurance against a compromised token.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @Post('trial')
  async startTrial(@Request() req) {
    const trial = await this.trials.activate(req.user.id, 'backend', 'pro');
    return { success: true, endsAt: trial.endsAt };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('trial')
  async trialStatus(@Request() req) {
    const t = await this.trials.status(req.user.id);
    if (!t) return { trial: null };
    return {
      trial: {
        endsAt: t.endsAt,
        plan: t.plan,
        source: t.source,
        consumed: t.consumed,
      },
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('invite')
  async invite(@Request() req, @Body() dto: InviteDto) {
    await this.billingService.activateProInvite(req.user.id, dto.email);
    return { success: true, message: `Invite sent to ${dto.email}` };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Delete('invite')
  async removeInvite(@Request() req) {
    await this.billingService.removeProInvite(req.user.id);
    return { success: true, message: 'Invite removed' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sync-revenuecat')
  async syncRevenueCat(
    @Request() req,
    @Body() dto: SyncRevenueCatDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const result = await this.idempotency.run(
        req.user.id,
        'billing.sync-revenuecat',
        idempotencyKey,
        dto,
        async () => {
          await this.billingService.syncRevenueCat(req.user.id, dto.productId);
          return { statusCode: 200, body: { success: true } };
        },
      );
      return result.body;
    }
    await this.billingService.syncRevenueCat(req.user.id, dto.productId);
    return { success: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('cancel')
  async cancelBilling(
    @Request() req,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const result = await this.idempotency.run(
        req.user.id,
        'billing.cancel',
        idempotencyKey,
        null,
        async () => {
          await this.billingService.cancelSubscription(req.user.id);
          return { statusCode: 200, body: { message: 'Subscription cancelled' } };
        },
      );
      return result.body;
    }
    await this.billingService.cancelSubscription(req.user.id);
    return { message: 'Subscription cancelled' };
  }

  /**
   * Drift recovery — verifies the user's plan against RC entitlements and
   * resets the local copy when RC says they have nothing active. Mobile
   * calls this when it detects RC entitlements empty but `/billing/me`
   * still reporting a paid plan (lost EXPIRATION webhook, manual grants,
   * stale state after sandbox testing).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('reconcile')
  async reconcile(@Request() req) {
    const result = await this.billingService.reconcileRevenueCat(req.user.id);
    return { success: true, ...result };
  }
}
