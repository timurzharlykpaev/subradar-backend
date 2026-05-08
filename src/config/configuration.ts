// Fail-closed in non-dev environments: refuse to boot without secrets that
// materially affect security. CASA / ASVS V2.10 forbids predictable default
// values for credential-bearing config. We allow dev defaults ONLY for
// NODE_ENV=development|test so local/CI startup works without a fully
// provisioned .env. Anything else (production, staging, preview, missing)
// is treated as "potentially user-facing" and must supply the env var
// explicitly. Whitespace-only values are rejected to catch misformatted
// .env files.
const DEV_ENVS = new Set(['development', 'test']);
function isDevEnvironment(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase().trim();
  return DEV_ENVS.has(env);
}
// Sentinel value used by both `configuration.ts` and `auth.module.ts` when
// running in dev without an explicit secret. Kept in one place so the two
// fallback paths agree (a divergence would mint dev tokens that one path
// can sign but the other can't verify). Different for access vs refresh
// so a leaked dev access token cannot be replayed against the refresh
// code path. There is a runtime assertion in configuration() below that
// the two values are different — do not collapse to a single literal.
export const DEV_JWT_ACCESS_SENTINEL =
  'dev-only-jwt-access-secret-do-not-use-in-prod';
export const DEV_JWT_REFRESH_SENTINEL =
  'dev-only-jwt-refresh-secret-do-not-use-in-prod';

function requireSecret(...names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim().length > 0) return v;
  }
  if (!isDevEnvironment()) {
    throw new Error(
      `Missing required secret: one of [${names.join(', ')}] must be set when NODE_ENV is not development|test`,
    );
  }
  // Specific sentinels for known JWT secret names; everything else gets a
  // generic sentinel templated off the env var name. The JWT branches are
  // typed so callers can rely on a stable string.
  if (names.includes('JWT_ACCESS_SECRET') || names.includes('JWT_SECRET')) {
    return DEV_JWT_ACCESS_SENTINEL;
  }
  if (names.includes('JWT_REFRESH_SECRET')) {
    return DEV_JWT_REFRESH_SENTINEL;
  }
  return `dev-only-${names[0].toLowerCase()}-do-not-use-in-prod`;
}

// Runtime assertion: the two dev sentinels must differ, otherwise the
// "leaked dev access token can't replay against refresh" property
// silently regresses if someone "cleans up" requireSecret to a literal.
// `as string` widens the literal types so TS doesn't fold this away.
if ((DEV_JWT_ACCESS_SENTINEL as string) === (DEV_JWT_REFRESH_SENTINEL as string)) {
  throw new Error(
    'DEV_JWT_ACCESS_SENTINEL must differ from DEV_JWT_REFRESH_SENTINEL',
  );
}

export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',

  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'subradar',
  },

  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    secret: requireSecret('JWT_ACCESS_SECRET', 'JWT_SECRET'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ||
      'http://localhost:3000/api/v1/auth/google/callback',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },

  spaces: {
    key: process.env.DO_SPACES_KEY,
    secret: process.env.DO_SPACES_SECRET,
    endpoint:
      process.env.DO_SPACES_ENDPOINT || 'https://fra1.digitaloceanspaces.com',
    bucket: process.env.DO_SPACES_BUCKET || 'subradar',
    cdnUrl: process.env.DO_SPACES_CDN_URL,
  },

  lemonSqueezy: {
    apiKey: process.env.LEMON_SQUEEZY_API_KEY,
    webhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
    storeId: process.env.LEMON_SQUEEZY_STORE_ID,
    proVariantId: process.env.LEMON_SQUEEZY_PRO_VARIANT_ID,
    teamVariantId: process.env.LEMON_SQUEEZY_TEAM_VARIANT_ID,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@subradar.ai',
  },
});
