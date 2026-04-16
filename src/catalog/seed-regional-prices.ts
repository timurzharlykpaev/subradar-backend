import { DataSource } from 'typeorm';

/**
 * Seed real regional prices for top services across 6 regions.
 * Idempotent — safe to run multiple times (upserts on serviceId+region+planName).
 */

interface ServiceSeed {
  name: string;
  slug: string;
  category: string;
  iconUrl: string | null;
  websiteUrl: string;
  aliases: string[];
}

interface PlanSeed {
  slug: string; // references service slug
  region: string;
  planName: string;
  price: number;
  currency: string;
  period: string;
  trialDays: number | null;
  features: string[];
}

// ── Services ──────────────────────────────────────────────────────────────────

const SERVICES: ServiceSeed[] = [
  {
    name: 'YouTube Premium',
    slug: 'youtube-premium',
    category: 'STREAMING',
    iconUrl: null,
    websiteUrl: 'https://www.youtube.com/premium',
    aliases: ['YouTube', 'YT Premium'],
  },
  {
    name: 'Netflix',
    slug: 'netflix',
    category: 'STREAMING',
    iconUrl: null,
    websiteUrl: 'https://www.netflix.com',
    aliases: [],
  },
  {
    name: 'Spotify',
    slug: 'spotify',
    category: 'MUSIC',
    iconUrl: null,
    websiteUrl: 'https://www.spotify.com',
    aliases: [],
  },
  {
    name: 'ChatGPT Plus',
    slug: 'chatgpt-plus',
    category: 'AI_SERVICES',
    iconUrl: null,
    websiteUrl: 'https://chat.openai.com',
    aliases: ['OpenAI', 'ChatGPT'],
  },
  {
    name: 'Claude Pro',
    slug: 'claude-pro',
    category: 'AI_SERVICES',
    iconUrl: null,
    websiteUrl: 'https://claude.ai',
    aliases: ['Anthropic', 'Claude'],
  },
  {
    name: 'Figma',
    slug: 'figma',
    category: 'DESIGN',
    iconUrl: null,
    websiteUrl: 'https://www.figma.com',
    aliases: [],
  },
  {
    name: 'Slack',
    slug: 'slack',
    category: 'PRODUCTIVITY',
    iconUrl: null,
    websiteUrl: 'https://slack.com',
    aliases: [],
  },
  {
    name: 'Notion',
    slug: 'notion',
    category: 'PRODUCTIVITY',
    iconUrl: null,
    websiteUrl: 'https://www.notion.so',
    aliases: [],
  },
  {
    name: 'Apple Music',
    slug: 'apple-music',
    category: 'MUSIC',
    iconUrl: null,
    websiteUrl: 'https://www.apple.com/apple-music/',
    aliases: [],
  },
  {
    name: 'Apple One',
    slug: 'apple-one',
    category: 'STREAMING',
    iconUrl: null,
    websiteUrl: 'https://www.apple.com/apple-one/',
    aliases: [],
  },
  {
    name: 'iCloud+',
    slug: 'icloud-plus',
    category: 'INFRASTRUCTURE',
    iconUrl: null,
    websiteUrl: 'https://www.apple.com/icloud/',
    aliases: ['iCloud'],
  },
  {
    name: 'Google One',
    slug: 'google-one',
    category: 'INFRASTRUCTURE',
    iconUrl: null,
    websiteUrl: 'https://one.google.com',
    aliases: [],
  },
  {
    name: 'Microsoft 365',
    slug: 'microsoft-365',
    category: 'PRODUCTIVITY',
    iconUrl: null,
    websiteUrl: 'https://www.microsoft.com/microsoft-365',
    aliases: ['Office 365', 'MS 365'],
  },
  {
    name: 'Adobe Creative Cloud',
    slug: 'adobe-creative-cloud',
    category: 'DESIGN',
    iconUrl: null,
    websiteUrl: 'https://www.adobe.com/creativecloud.html',
    aliases: ['Adobe CC'],
  },
  {
    name: 'GitHub Pro',
    slug: 'github-pro',
    category: 'DEVELOPER',
    iconUrl: null,
    websiteUrl: 'https://github.com',
    aliases: ['GitHub'],
  },
  {
    name: 'Disney+',
    slug: 'disney-plus',
    category: 'STREAMING',
    iconUrl: null,
    websiteUrl: 'https://www.disneyplus.com',
    aliases: ['Disney Plus'],
  },
  {
    name: 'Telegram Premium',
    slug: 'telegram-premium',
    category: 'PRODUCTIVITY',
    iconUrl: null,
    websiteUrl: 'https://telegram.org',
    aliases: ['Telegram'],
  },
  {
    name: 'LinkedIn Premium',
    slug: 'linkedin-premium',
    category: 'BUSINESS',
    iconUrl: null,
    websiteUrl: 'https://www.linkedin.com/premium',
    aliases: ['LinkedIn'],
  },
  {
    name: 'Dropbox',
    slug: 'dropbox',
    category: 'INFRASTRUCTURE',
    iconUrl: null,
    websiteUrl: 'https://www.dropbox.com',
    aliases: [],
  },
  {
    name: 'Cursor Pro',
    slug: 'cursor-pro',
    category: 'DEVELOPER',
    iconUrl: null,
    websiteUrl: 'https://cursor.sh',
    aliases: ['Cursor'],
  },
];

// ── Plans (real regional prices) ──────────────────────────────────────────────

const PLANS: PlanSeed[] = [
  // ─── YouTube Premium ─────────────────────────────────────────
  // US
  { slug: 'youtube-premium', region: 'US', planName: 'Individual', price: 13.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'US', planName: 'Family', price: 22.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },
  // KZ
  { slug: 'youtube-premium', region: 'KZ', planName: 'Individual', price: 1190, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'KZ', planName: 'Family', price: 2390, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },
  // RU
  { slug: 'youtube-premium', region: 'RU', planName: 'Individual', price: 299, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'RU', planName: 'Family', price: 549, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },
  // UA
  { slug: 'youtube-premium', region: 'UA', planName: 'Individual', price: 99, currency: 'UAH', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'UA', planName: 'Family', price: 149, currency: 'UAH', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },
  // TR
  { slug: 'youtube-premium', region: 'TR', planName: 'Individual', price: 57.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'TR', planName: 'Family', price: 107.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },
  // DE
  { slug: 'youtube-premium', region: 'DE', planName: 'Individual', price: 12.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Background play', 'YouTube Music'] },
  { slug: 'youtube-premium', region: 'DE', planName: 'Family', price: 23.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Up to 5 members', 'Ad-free', 'YouTube Music'] },

  // ─── Netflix ─────────────────────────────────────────────────
  // US
  { slug: 'netflix', region: 'US', planName: 'Standard with Ads', price: 6.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['1080p', 'Ads'] },
  { slug: 'netflix', region: 'US', planName: 'Standard', price: 15.49, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', '2 screens'] },
  { slug: 'netflix', region: 'US', planName: 'Premium', price: 22.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },
  // KZ (no ads tier)
  { slug: 'netflix', region: 'KZ', planName: 'Standard', price: 3490, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', '2 screens'] },
  { slug: 'netflix', region: 'KZ', planName: 'Premium', price: 4490, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },
  // RU — not available, omitted
  // UA
  { slug: 'netflix', region: 'UA', planName: 'Standard', price: 15.49, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', '2 screens'] },
  { slug: 'netflix', region: 'UA', planName: 'Premium', price: 22.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },
  // TR
  { slug: 'netflix', region: 'TR', planName: 'Standard', price: 149.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', '2 screens'] },
  { slug: 'netflix', region: 'TR', planName: 'Premium', price: 199.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },
  // DE
  { slug: 'netflix', region: 'DE', planName: 'Standard', price: 12.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', '2 screens'] },
  { slug: 'netflix', region: 'DE', planName: 'Premium', price: 17.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },

  // ─── Spotify ─────────────────────────────────────────────────
  // US
  { slug: 'spotify', region: 'US', planName: 'Individual', price: 11.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'US', planName: 'Family', price: 19.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },
  // KZ
  { slug: 'spotify', region: 'KZ', planName: 'Individual', price: 1790, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'KZ', planName: 'Family', price: 2690, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },
  // RU
  { slug: 'spotify', region: 'RU', planName: 'Individual', price: 299, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'RU', planName: 'Family', price: 449, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },
  // UA
  { slug: 'spotify', region: 'UA', planName: 'Individual', price: 79, currency: 'UAH', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'UA', planName: 'Family', price: 129, currency: 'UAH', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },
  // TR
  { slug: 'spotify', region: 'TR', planName: 'Individual', price: 59.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'TR', planName: 'Family', price: 99.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },
  // DE
  { slug: 'spotify', region: 'DE', planName: 'Individual', price: 10.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Ad-free', 'Offline', 'High quality'] },
  { slug: 'spotify', region: 'DE', planName: 'Family', price: 17.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 accounts', 'Ad-free'] },

  // ─── ChatGPT Plus (global USD price) ────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'chatgpt-plus', region, planName: 'Plus', price: 20, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['GPT-4o', 'DALL-E', 'Advanced tools'],
  })),

  // ─── Claude Pro (global USD price) ──────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'claude-pro', region, planName: 'Pro', price: 20, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['Claude Opus/Sonnet', 'Priority access', 'Higher limits'],
  })),

  // ─── Figma (global USD price) ───────────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'figma', region, planName: 'Professional', price: 15, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['Unlimited projects', 'Team libraries'],
  })),
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'figma', region, planName: 'Organization', price: 45, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['SSO', 'Design system analytics', 'Branching'],
  })),

  // ─── Slack (global USD price) ───────────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'slack', region, planName: 'Pro', price: 8.75, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['Unlimited history', 'Groups', 'Apps'],
  })),
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'slack', region, planName: 'Business+', price: 12.50, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['SAML SSO', 'Data exports', 'Compliance'],
  })),

  // ─── Notion (global USD price) ──────────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'notion', region, planName: 'Plus', price: 10, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['Unlimited blocks', 'Unlimited file uploads'],
  })),
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'notion', region, planName: 'Business', price: 18, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['SAML SSO', 'Advanced permissions', 'Bulk export'],
  })),

  // ─── Apple Music ─────────────────────────────────────────────
  { slug: 'apple-music', region: 'US', planName: 'Individual', price: 10.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'US', planName: 'Family', price: 16.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 members', 'Lossless'] },
  { slug: 'apple-music', region: 'KZ', planName: 'Individual', price: 990, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'KZ', planName: 'Family', price: 1490, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 members', 'Lossless'] },
  { slug: 'apple-music', region: 'RU', planName: 'Individual', price: 199, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'RU', planName: 'Family', price: 299, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 members', 'Lossless'] },
  { slug: 'apple-music', region: 'UA', planName: 'Individual', price: 59, currency: 'UAH', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'TR', planName: 'Individual', price: 39.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'DE', planName: 'Individual', price: 10.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['100M songs', 'Lossless', 'Spatial Audio'] },
  { slug: 'apple-music', region: 'DE', planName: 'Family', price: 16.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Up to 6 members', 'Lossless'] },

  // ─── Apple One ───────────────────────────────────────────────
  { slug: 'apple-one', region: 'US', planName: 'Individual', price: 19.95, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Music', 'TV+', 'Arcade', 'iCloud+ 50GB'] },
  { slug: 'apple-one', region: 'US', planName: 'Family', price: 25.95, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['Music', 'TV+', 'Arcade', 'iCloud+ 200GB', 'Up to 6'] },
  { slug: 'apple-one', region: 'KZ', planName: 'Individual', price: 2490, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['Music', 'TV+', 'Arcade', 'iCloud+ 50GB'] },
  { slug: 'apple-one', region: 'DE', planName: 'Individual', price: 19.95, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['Music', 'TV+', 'Arcade', 'iCloud+ 50GB'] },
  { slug: 'apple-one', region: 'TR', planName: 'Individual', price: 109.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['Music', 'TV+', 'Arcade', 'iCloud+ 50GB'] },

  // ─── iCloud+ ─────────────────────────────────────────────────
  { slug: 'icloud-plus', region: 'US', planName: '50 GB', price: 0.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['50 GB storage', 'iCloud Private Relay'] },
  { slug: 'icloud-plus', region: 'US', planName: '200 GB', price: 2.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['200 GB storage', 'Family sharing'] },
  { slug: 'icloud-plus', region: 'US', planName: '2 TB', price: 9.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['2 TB storage', 'Family sharing'] },
  { slug: 'icloud-plus', region: 'KZ', planName: '50 GB', price: 449, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['50 GB storage'] },
  { slug: 'icloud-plus', region: 'KZ', planName: '200 GB', price: 1290, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['200 GB storage'] },
  { slug: 'icloud-plus', region: 'RU', planName: '50 GB', price: 99, currency: 'RUB', period: 'MONTHLY', trialDays: null, features: ['50 GB storage'] },
  { slug: 'icloud-plus', region: 'RU', planName: '200 GB', price: 299, currency: 'RUB', period: 'MONTHLY', trialDays: null, features: ['200 GB storage'] },
  { slug: 'icloud-plus', region: 'TR', planName: '50 GB', price: 14.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['50 GB storage'] },
  { slug: 'icloud-plus', region: 'DE', planName: '50 GB', price: 0.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['50 GB storage'] },
  { slug: 'icloud-plus', region: 'DE', planName: '200 GB', price: 2.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['200 GB storage'] },

  // ─── Google One ──────────────────────────────────────────────
  { slug: 'google-one', region: 'US', planName: '100 GB', price: 1.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['100 GB storage', 'VPN'] },
  { slug: 'google-one', region: 'US', planName: '2 TB', price: 9.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['2 TB storage', 'VPN', 'Family sharing'] },
  { slug: 'google-one', region: 'KZ', planName: '100 GB', price: 849, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['100 GB storage'] },
  { slug: 'google-one', region: 'KZ', planName: '2 TB', price: 4290, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['2 TB storage'] },
  { slug: 'google-one', region: 'RU', planName: '100 GB', price: 139, currency: 'RUB', period: 'MONTHLY', trialDays: null, features: ['100 GB storage'] },
  { slug: 'google-one', region: 'TR', planName: '100 GB', price: 34.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['100 GB storage'] },
  { slug: 'google-one', region: 'DE', planName: '100 GB', price: 1.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['100 GB storage'] },
  { slug: 'google-one', region: 'DE', planName: '2 TB', price: 9.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['2 TB storage'] },

  // ─── Microsoft 365 ───────────────────────────────────────────
  { slug: 'microsoft-365', region: 'US', planName: 'Personal', price: 9.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['1 TB OneDrive', 'Office apps'] },
  { slug: 'microsoft-365', region: 'US', planName: 'Family', price: 12.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['6 TB total', 'Up to 6 users'] },
  { slug: 'microsoft-365', region: 'KZ', planName: 'Personal', price: 3990, currency: 'KZT', period: 'MONTHLY', trialDays: 30, features: ['1 TB OneDrive', 'Office apps'] },
  { slug: 'microsoft-365', region: 'RU', planName: 'Personal', price: 399, currency: 'RUB', period: 'MONTHLY', trialDays: 30, features: ['1 TB OneDrive', 'Office apps'] },
  { slug: 'microsoft-365', region: 'TR', planName: 'Personal', price: 89.99, currency: 'TRY', period: 'MONTHLY', trialDays: 30, features: ['1 TB OneDrive', 'Office apps'] },
  { slug: 'microsoft-365', region: 'DE', planName: 'Personal', price: 7.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['1 TB OneDrive', 'Office apps'] },
  { slug: 'microsoft-365', region: 'DE', planName: 'Family', price: 10.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['6 TB total', 'Up to 6 users'] },

  // ─── Adobe Creative Cloud (global USD, EU in EUR) ───────────
  ...['US', 'KZ', 'RU', 'UA', 'TR'].map((region): PlanSeed => ({
    slug: 'adobe-creative-cloud', region, planName: 'All Apps', price: 59.99, currency: 'USD', period: 'MONTHLY', trialDays: 7, features: ['Photoshop', 'Illustrator', 'Premiere Pro', '100GB cloud'],
  })),
  { slug: 'adobe-creative-cloud', region: 'DE', planName: 'All Apps', price: 61.95, currency: 'EUR', period: 'MONTHLY', trialDays: 7, features: ['Photoshop', 'Illustrator', 'Premiere Pro', '100GB cloud'] },

  // ─── GitHub Pro (global USD) ────────────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'github-pro', region, planName: 'Pro', price: 4, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['Advanced code review', 'Protected branches', 'Actions minutes'],
  })),

  // ─── Disney+ ─────────────────────────────────────────────────
  { slug: 'disney-plus', region: 'US', planName: 'Standard with Ads', price: 7.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['1080p', 'Ads'] },
  { slug: 'disney-plus', region: 'US', planName: 'Standard', price: 13.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads', 'Download'] },
  { slug: 'disney-plus', region: 'TR', planName: 'Standard', price: 134.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads'] },
  { slug: 'disney-plus', region: 'DE', planName: 'Standard', price: 8.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['1080p', 'No ads'] },
  { slug: 'disney-plus', region: 'DE', planName: 'Premium', price: 11.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['4K+HDR', 'No ads', '4 screens'] },

  // ─── Telegram Premium ────────────────────────────────────────
  { slug: 'telegram-premium', region: 'US', planName: 'Premium', price: 4.99, currency: 'USD', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },
  { slug: 'telegram-premium', region: 'KZ', planName: 'Premium', price: 1490, currency: 'KZT', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },
  { slug: 'telegram-premium', region: 'RU', planName: 'Premium', price: 299, currency: 'RUB', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },
  { slug: 'telegram-premium', region: 'UA', planName: 'Premium', price: 99, currency: 'UAH', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },
  { slug: 'telegram-premium', region: 'TR', planName: 'Premium', price: 64.99, currency: 'TRY', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },
  { slug: 'telegram-premium', region: 'DE', planName: 'Premium', price: 4.99, currency: 'EUR', period: 'MONTHLY', trialDays: null, features: ['4 GB uploads', 'No ads', 'Exclusive stickers'] },

  // ─── LinkedIn Premium (global USD, EUR for DE) ──────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR'].map((region): PlanSeed => ({
    slug: 'linkedin-premium', region, planName: 'Career', price: 29.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['InMail credits', 'Who viewed profile', 'Top applicant'],
  })),
  { slug: 'linkedin-premium', region: 'DE', planName: 'Career', price: 29.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['InMail credits', 'Who viewed profile', 'Top applicant'] },

  // ─── Dropbox (global USD, EUR for DE) ───────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR'].map((region): PlanSeed => ({
    slug: 'dropbox', region, planName: 'Plus', price: 11.99, currency: 'USD', period: 'MONTHLY', trialDays: 30, features: ['2 TB storage', 'Smart sync'],
  })),
  { slug: 'dropbox', region: 'DE', planName: 'Plus', price: 11.99, currency: 'EUR', period: 'MONTHLY', trialDays: 30, features: ['2 TB storage', 'Smart sync'] },

  // ─── Cursor Pro (global USD) ────────────────────────────────
  ...['US', 'KZ', 'RU', 'UA', 'TR', 'DE'].map((region): PlanSeed => ({
    slug: 'cursor-pro', region, planName: 'Pro', price: 20, currency: 'USD', period: 'MONTHLY', trialDays: 14, features: ['Unlimited completions', 'GPT-4/Claude', 'Fast requests'],
  })),
];

// ── Seed function ─────────────────────────────────────────────────────────────

export async function seedRegionalPrices(dataSource: DataSource): Promise<void> {
  const serviceIdBySlug = new Map<string, string>();

  // Step 1: Upsert services
  for (const svc of SERVICES) {
    const existing = await dataSource.query(
      `SELECT "id" FROM "catalog_services" WHERE "slug" = $1 LIMIT 1`,
      [svc.slug],
    );

    let serviceId: string;
    if (existing.length > 0) {
      serviceId = existing[0].id;
    } else {
      const inserted = await dataSource.query(
        `INSERT INTO "catalog_services" ("slug", "name", "category", "iconUrl", "websiteUrl", "aliases")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING "id"`,
        [svc.slug, svc.name, svc.category, svc.iconUrl, svc.websiteUrl, svc.aliases],
      );
      serviceId = inserted[0].id;
    }
    serviceIdBySlug.set(svc.slug, serviceId);
  }

  // Step 2: Upsert plans
  let upserted = 0;
  for (const plan of PLANS) {
    const serviceId = serviceIdBySlug.get(plan.slug);
    if (!serviceId) {
      console.warn(`Service slug "${plan.slug}" not found, skipping plan`);
      continue;
    }

    await dataSource.query(
      `INSERT INTO "catalog_plans"
        ("serviceId", "region", "planName", "price", "currency", "period",
         "trialDays", "features", "priceSource", "priceConfidence", "lastPriceRefreshAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MANUAL', 'HIGH', NOW())
       ON CONFLICT ("serviceId", "region", "planName")
       DO UPDATE SET
         "price" = EXCLUDED."price",
         "currency" = EXCLUDED."currency",
         "period" = EXCLUDED."period",
         "trialDays" = EXCLUDED."trialDays",
         "features" = EXCLUDED."features",
         "priceSource" = 'MANUAL',
         "priceConfidence" = 'HIGH',
         "lastPriceRefreshAt" = NOW()`,
      [
        serviceId,
        plan.region,
        plan.planName,
        plan.price,
        plan.currency,
        plan.period,
        plan.trialDays,
        plan.features,
      ],
    );
    upserted++;
  }

  console.log(
    `Seeded ${SERVICES.length} services, ${upserted} plans across 6 regions`,
  );
}
