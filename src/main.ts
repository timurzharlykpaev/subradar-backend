import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { TelegramAlertService } from './common/telegram-alert.service';

async function bootstrap() {
  // Disable Nest's built-in body parser. We register our own below with a
  // `verify` callback so we can capture the raw bytes needed for HMAC
  // verification of Lemon Squeezy (and future provider) webhooks.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Global JSON parser — captures `req.rawBody` on every request so that
  // webhook endpoints can verify signatures against the exact bytes we
  // received. Keep the body size high enough for AI image/audio uploads.
  app.use(
    bodyParser.json({
      limit: '10mb',
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  // CORS — must be before helmet
  const allowedOrigins = (process.env.CORS_ORIGINS || 'https://app.subradar.ai')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Heuristic: identify non-browser clients (mobile apps, server-to-server, curl)
  // which legitimately don't send an Origin header. Browsers always send Origin
  // on cross-site requests, so any web origin MUST be in the allowlist.
  const NON_BROWSER_UA = /\b(okhttp|axios|expo|CFNetwork|Darwin|Dart|curl|Postman|node(?:-fetch)?)\b/i;
  const isNonBrowserClient = (req: any): boolean => {
    const headers = req?.headers ?? {};
    // Explicit opt-in header our mobile client can send
    const clientHint = String(headers['x-client'] || '').toLowerCase();
    if (clientHint === 'mobile' || clientHint === 'ios' || clientHint === 'android') return true;
    const ua = String(headers['user-agent'] || '');
    return NON_BROWSER_UA.test(ua);
  };

  app.enableCors({
    origin: (origin, cb) => {
      if (origin && allowedOrigins.includes(origin)) return cb(null, true);
      // No Origin: only accept when the client is clearly not a browser
      // (prevents cross-site CSRF-style requests from unknown web pages).
      // Note: we can't see the request here, so we fall through to a
      // second layer of validation via a middleware below.
      if (!origin) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client'],
  });

  // Middleware-level enforcement: reject ORIGINless, state-changing requests
  // that don't carry a mobile client hint or a non-browser User-Agent.
  // Rationale: the CORS `origin` callback above permits `!origin` so native
  // mobile apps (no Origin) can reach us; this check prevents a malicious
  // web page from exploiting that loophole via `<form>`/`<img>` vectors.
  // Safelisted paths (webhooks, health, OAuth callback from external IdPs)
  // are allowed to bypass.
  const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const ORIGIN_BYPASS_PREFIXES = [
    '/api/v1/billing/webhook',
    // RevenueCat posts server-to-server with no Origin header and a UA
    // (`RevenueCat-Backend`) that doesn't match the non-browser regex —
    // without this prefix every CANCELLATION/EXPIRATION/RENEWAL silently
    // gets a 403 and the user's plan never downgrades.
    '/api/v1/billing/revenuecat-webhook',
    '/api/v1/notifications/resend-webhook',
    '/api/v1/auth/google/callback',
    '/health',
    '/metrics',
  ];
  app.use((req: any, res: any, next: any) => {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (ORIGIN_BYPASS_PREFIXES.some((p) => req.url?.startsWith(p))) return next();
    const origin = req.headers?.origin;
    if (origin) return next(); // already validated by CORS middleware
    if (isNonBrowserClient(req)) return next();
    return res.status(403).json({
      success: false,
      statusCode: 403,
      message: 'CORS: origin or mobile client hint required',
      path: req.url,
    });
  });

  // Security headers — disable COOP to allow Google OAuth popup.
  // CSP is disabled here and configured explicitly below with the domains
  // we actually need (img/script/style allowlists).
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: false,
    }),
  );

  // Explicit Content Security Policy. This is primarily a JSON API, but
  // Swagger UI (dev) and any HTML error page benefit from a tight policy.
  app.use(
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://icon.horse'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    }),
  );

  app.setGlobalPrefix('api/v1');

  const tgAlert = app.get(TelegramAlertService);
  app.useGlobalFilters(new AllExceptionsFilter(tgAlert));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enforce @Exclude() on entity fields (refreshToken, magicLinkToken,
  // lemonSqueezyCustomerId, password). Without this interceptor, entities
  // returned from controllers leak every column to clients.
  // CacheControlInterceptor sets `Cache-Control: private, no-store` as the
  // default for every response. Routes that want edge caching opt in via
  // `@Header('Cache-Control', '...')` — see catalog/fx/ai-catalog. Without
  // this default, CF / browser caches were free to apply their own
  // heuristics, which is risky for any user-scoped endpoint.
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new CacheControlInterceptor(),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SubRadar AI API')
      .setDescription('Subscription management with AI-powered insights')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`SubRadar API running on http://localhost:${port}/api/v1`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
void bootstrap();
