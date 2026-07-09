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

import type { EmailCandidate } from './ai.service';

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

// Google S2 favicons — reliable real-brand logos (incl. openai.com, which
// icon.horse serves as a grey-letter placeholder). Matches the mobile app's
// canonical source (`src/utils/iconUrl.ts` domainIconUrl), so the icon never
// gets rewritten client-side and old clients rendering the URL directly still
// get a real logo instead of the ChatGPT placeholder.
const icon = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

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

// ─── Gmail scan demo ──────────────────────────────────────────────────────
// Curated "found in your inbox" list for the demo Gmail scan. Deliberately
// uses recognizable brands the seeded demo accounts DON'T already have
// (see scripts/seed-demo-users.js), so the review sheet always surfaces a
// full, photogenic set of finds on camera even after the real dedup pass runs.
interface DemoFoundService {
  name: string;
  domain: string;
  category: string;
  monthly: number;
  serviceUrl: string;
  cancelUrl: string;
  daysUntil: number;
}

const GMAIL_FOUND: DemoFoundService[] = [
  {
    name: 'Disney+',
    domain: 'disneyplus.com',
    category: 'STREAMING',
    monthly: 15.99,
    serviceUrl: 'https://www.disneyplus.com',
    cancelUrl: 'https://www.disneyplus.com/account/subscription',
    daysUntil: 6,
  },
  {
    name: 'Amazon Prime',
    domain: 'amazon.com',
    category: 'STREAMING',
    monthly: 14.99,
    serviceUrl: 'https://www.amazon.com/prime',
    cancelUrl: 'https://www.amazon.com/gp/primecentral',
    daysUntil: 12,
  },
  {
    name: 'Max',
    domain: 'max.com',
    category: 'STREAMING',
    monthly: 15.99,
    serviceUrl: 'https://www.max.com',
    cancelUrl: 'https://www.max.com/account',
    daysUntil: 9,
  },
  {
    name: 'Dropbox',
    domain: 'dropbox.com',
    category: 'PRODUCTIVITY',
    monthly: 11.99,
    serviceUrl: 'https://www.dropbox.com',
    cancelUrl: 'https://www.dropbox.com/account/plan',
    daysUntil: 20,
  },
  {
    name: 'NordVPN',
    domain: 'nordvpn.com',
    category: 'SECURITY',
    monthly: 12.99,
    serviceUrl: 'https://nordvpn.com',
    cancelUrl: 'https://my.nordaccount.com',
    daysUntil: 3,
  },
  {
    name: 'Duolingo',
    domain: 'duolingo.com',
    category: 'EDUCATION',
    monthly: 6.99,
    serviceUrl: 'https://www.duolingo.com',
    cancelUrl: 'https://www.duolingo.com/settings',
    daysUntil: 27,
  },
  {
    name: 'Audible',
    domain: 'audible.com',
    category: 'OTHER',
    monthly: 14.95,
    serviceUrl: 'https://www.audible.com',
    cancelUrl: 'https://www.audible.com/account',
    daysUntil: 15,
  },
];

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Shape of `GmailScanService.scan` — served for active demo accounts so the
 * "Connect Gmail → scan" recording always finds a clean, full list without
 * touching a real inbox, calling the AI, or spending OpenAI quota.
 */
export function demoGmailScan(ctx: DemoLocaleCtx): {
  scanned: number;
  candidates: EmailCandidate[];
  durationMs: number;
  truncated: boolean;
  summary: { aiReturned: number; droppedNoise: number; droppedDup: number };
} {
  const candidates: EmailCandidate[] = GMAIL_FOUND.map((s, i) => ({
    sourceMessageId: `demo-msg-${i + 1}`,
    name: s.name,
    amount: s.monthly,
    currency: ctx.currency,
    billingPeriod: 'MONTHLY',
    category: s.category,
    status: 'ACTIVE',
    nextPaymentDate: daysFromNow(s.daysUntil),
    confidence: 0.97,
    isRecurring: true,
    isCancellation: false,
    isTrial: false,
    aggregatedFrom: [`demo-msg-${i + 1}`],
    amountFromEmail: true,
    iconUrl: icon(s.domain),
    serviceUrl: s.serviceUrl,
    cancelUrl: s.cancelUrl,
  }));
  return {
    scanned: 187,
    candidates,
    durationMs: 2400,
    truncated: false,
    summary: {
      aiReturned: candidates.length,
      droppedNoise: 0,
      droppedDup: 0,
    },
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
