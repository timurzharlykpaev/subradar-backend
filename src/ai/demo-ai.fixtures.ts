/**
 * Deterministic AI responses for demo accounts (testN@subradar.ai).
 *
 * When ENABLE_DEMO_ACCOUNTS is on, the AI controller short-circuits every
 * "add a subscription via AI" flow to these fixtures instead of calling
 * OpenAI. This makes recorded App Store / social videos reproducible (the
 * scan always resolves to the same clean result), costs nothing, and never
 * touches a real account — the gate is `isActiveDemoAccount(req.user.email)`.
 *
 * Shapes here mirror exactly what the matching `AiService` method returns, so
 * the mobile/web clients can't tell the difference.
 */

export interface DemoLocaleCtx {
  locale: string;
  currency: string;
  country: string;
}

interface DemoService {
  name: string;
  domain: string;
  category: string;
  plan: string;
  monthly: number;
  yearly: number;
  serviceUrl: string;
  cancelUrl: string;
}

const icon = (domain: string): string => `https://icon.horse/icon/${domain}`;

// Curated, real-world 2026 US pricing — every entry has a recognisable icon.
const CATALOG: DemoService[] = [
  {
    name: 'Netflix',
    domain: 'netflix.com',
    category: 'STREAMING',
    plan: 'Premium',
    monthly: 22.99,
    yearly: 275.88,
    serviceUrl: 'https://www.netflix.com',
    cancelUrl: 'https://www.netflix.com/cancelplan',
  },
  {
    name: 'Spotify',
    domain: 'spotify.com',
    category: 'MUSIC',
    plan: 'Premium Individual',
    monthly: 11.99,
    yearly: 119.99,
    serviceUrl: 'https://www.spotify.com',
    cancelUrl: 'https://www.spotify.com/account/subscription',
  },
  {
    name: 'ChatGPT Plus',
    domain: 'openai.com',
    category: 'AI_SERVICES',
    plan: 'Plus',
    monthly: 20,
    yearly: 240,
    serviceUrl: 'https://chatgpt.com',
    cancelUrl: 'https://chatgpt.com/#settings/Subscription',
  },
  {
    name: 'YouTube Premium',
    domain: 'youtube.com',
    category: 'STREAMING',
    plan: 'Individual',
    monthly: 13.99,
    yearly: 139.99,
    serviceUrl: 'https://www.youtube.com/premium',
    cancelUrl: 'https://www.youtube.com/paid_memberships',
  },
  {
    name: 'iCloud+',
    domain: 'icloud.com',
    category: 'INFRASTRUCTURE',
    plan: '2TB',
    monthly: 9.99,
    yearly: 119.88,
    serviceUrl: 'https://www.icloud.com',
    cancelUrl: 'https://support.apple.com/en-us/HT207594',
  },
  {
    name: 'Notion',
    domain: 'notion.so',
    category: 'PRODUCTIVITY',
    plan: 'Plus',
    monthly: 10,
    yearly: 96,
    serviceUrl: 'https://www.notion.so',
    cancelUrl: 'https://www.notion.so/my-account',
  },
];

// Default when a query doesn't name a known service — a clean, photogenic
// result for the camera.
const DEFAULT_SERVICE = CATALOG[2]; // ChatGPT Plus

/**
 * Light keyword match so a presenter can type/say a known brand and get the
 * matching clean result on screen; everything else resolves to the default.
 * Fully deterministic — no network, no model.
 */
function pickService(query?: string): DemoService {
  const q = (query ?? '').toLowerCase();
  if (!q) return DEFAULT_SERVICE;
  return (
    CATALOG.find((s) => {
      const brand = s.name.toLowerCase().split(' ')[0];
      const root = s.domain.split('.')[0];
      return q.includes(brand) || q.includes(root);
    }) ?? DEFAULT_SERVICE
  );
}

/** Today as an ISO date string (no Date.now lint issue — plain runtime code). */
function today(): string {
  return new Date().toISOString();
}

/** Shape of `AiService.lookupService` — used by /ai/lookup, /search, /parse-text. */
export function demoLookup(query: string, ctx: DemoLocaleCtx) {
  const s = pickService(query);
  return {
    name: s.name,
    serviceUrl: s.serviceUrl,
    cancelUrl: s.cancelUrl,
    category: s.category,
    plans: [
      {
        name: s.plan,
        price: s.monthly,
        currency: ctx.currency,
        period: 'MONTHLY',
      },
      {
        name: `${s.plan} (Annual)`,
        price: s.yearly,
        currency: ctx.currency,
        period: 'YEARLY',
      },
    ],
    priceNote: `Current ${ctx.country} pricing`,
    iconUrl: icon(s.domain),
  };
}

/** Shape of `AiService.parseScreenshot` — used by /ai/parse-screenshot. */
export function demoScreenshot(ctx: DemoLocaleCtx) {
  const s = CATALOG[0]; // Netflix — the canonical receipt for the camera
  return {
    name: s.name,
    amount: s.monthly,
    currency: ctx.currency,
    billingPeriod: 'MONTHLY',
    date: today(),
    planName: s.plan,
    category: s.category,
    iconUrl: icon(s.domain),
  };
}

/** Shape of `AiService.voiceToSubscription` — used by /ai/voice(-to-subscription). */
export function demoVoice(ctx: DemoLocaleCtx) {
  const s = CATALOG[1]; // Spotify
  return {
    name: s.name,
    amount: s.monthly,
    currency: ctx.currency,
    billingPeriod: 'MONTHLY',
    category: s.category,
    notes: '',
    startDate: today(),
  };
}

/** Shape of the single-plan `AiService.wizard` result — used by /ai/wizard. */
export function demoWizard(message: string, ctx: DemoLocaleCtx) {
  const s = pickService(message);
  return {
    done: true as const,
    subscription: {
      name: s.name,
      amount: s.monthly,
      currency: ctx.currency,
      billingPeriod: 'MONTHLY',
      category: s.category,
      serviceUrl: s.serviceUrl,
      cancelUrl: s.cancelUrl,
      iconUrl: icon(s.domain),
    },
  };
}

/** One bulk row — shared by /ai/parse-bulk and /ai/voice-bulk. */
function bulkRow(s: DemoService, ctx: DemoLocaleCtx) {
  return {
    name: s.name,
    amount: s.monthly,
    currency: ctx.currency,
    billingPeriod: 'MONTHLY',
    category: s.category,
    serviceUrl: s.serviceUrl,
    cancelUrl: s.cancelUrl,
    iconUrl: icon(s.domain),
  };
}

/** Shape of `AiService.parseBulkSubscriptions` — used by /ai/parse-bulk. */
export function demoBulk(ctx: DemoLocaleCtx) {
  return CATALOG.slice(0, 3).map((s) => bulkRow(s, ctx));
}

/** Shape of `AiService.voiceToBulkSubscriptions` — used by /ai/voice-bulk. */
export function demoVoiceBulk(ctx: DemoLocaleCtx) {
  return {
    text: 'Netflix, Spotify and ChatGPT Plus',
    subscriptions: demoBulk(ctx),
  };
}

/** Shape of `AiService.matchService` — used by /ai/match-service. */
export function demoMatch(name: string) {
  const s = pickService(name);
  return {
    matches: [
      {
        name: s.name,
        confidence: 0.98,
        iconUrl: icon(s.domain),
        website: s.serviceUrl,
        category: s.category,
      },
    ],
  };
}
