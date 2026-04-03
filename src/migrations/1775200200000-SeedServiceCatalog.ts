import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedServiceCatalog1775200200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const services = [
      { n: 'netflix', d: 'Netflix', c: 'STREAMING', p: [
        { name: 'Standard with Ads', priceMonthly: 7.99, currency: 'USD' },
        { name: 'Standard', priceMonthly: 15.49, currency: 'USD' },
        { name: 'Premium', priceMonthly: 22.99, currency: 'USD' },
      ], a: ['disney_plus', 'hulu', 'hbo_max', 'apple_tv_plus', 'amazon_prime_video'] },
      { n: 'disney_plus', d: 'Disney+', c: 'STREAMING', p: [
        { name: 'Basic', priceMonthly: 7.99, currency: 'USD' },
        { name: 'Premium', priceMonthly: 13.99, currency: 'USD' },
      ], a: ['netflix', 'hulu', 'hbo_max'] },
      { n: 'hulu', d: 'Hulu', c: 'STREAMING', p: [
        { name: 'Basic', priceMonthly: 7.99, currency: 'USD' },
        { name: 'No Ads', priceMonthly: 17.99, currency: 'USD' },
      ], a: ['netflix', 'disney_plus'] },
      { n: 'hbo_max', d: 'Max (HBO)', c: 'STREAMING', p: [
        { name: 'With Ads', priceMonthly: 9.99, currency: 'USD' },
        { name: 'Ad-Free', priceMonthly: 16.99, currency: 'USD' },
        { name: 'Ultimate', priceMonthly: 20.99, currency: 'USD' },
      ], a: ['netflix', 'disney_plus'] },
      { n: 'apple_tv_plus', d: 'Apple TV+', c: 'STREAMING', p: [
        { name: 'Monthly', priceMonthly: 9.99, currency: 'USD' },
      ], a: ['netflix', 'disney_plus'] },
      { n: 'amazon_prime_video', d: 'Amazon Prime Video', c: 'STREAMING', p: [
        { name: 'Prime Video', priceMonthly: 8.99, currency: 'USD' },
        { name: 'Prime (full)', priceMonthly: 14.99, currency: 'USD' },
      ], a: ['netflix', 'disney_plus'] },
      { n: 'youtube', d: 'YouTube Premium', c: 'STREAMING', p: [
        { name: 'Individual', priceMonthly: 13.99, currency: 'USD' },
        { name: 'Family', priceMonthly: 22.99, currency: 'USD' },
        { name: 'Student', priceMonthly: 7.99, currency: 'USD' },
      ], a: [] },
      { n: 'spotify', d: 'Spotify', c: 'MUSIC', p: [
        { name: 'Individual', priceMonthly: 11.99, currency: 'USD' },
        { name: 'Duo', priceMonthly: 16.99, currency: 'USD' },
        { name: 'Family', priceMonthly: 19.99, currency: 'USD' },
        { name: 'Student', priceMonthly: 5.99, currency: 'USD' },
      ], a: ['apple_music', 'youtube_music', 'tidal'] },
      { n: 'apple_music', d: 'Apple Music', c: 'MUSIC', p: [
        { name: 'Individual', priceMonthly: 10.99, currency: 'USD' },
        { name: 'Family', priceMonthly: 16.99, currency: 'USD' },
        { name: 'Student', priceMonthly: 5.99, currency: 'USD' },
      ], a: ['spotify', 'youtube_music'] },
      { n: 'chatgpt', d: 'ChatGPT', c: 'AI_SERVICES', p: [
        { name: 'Plus', priceMonthly: 20, currency: 'USD' },
        { name: 'Pro', priceMonthly: 200, currency: 'USD' },
      ], a: ['claude', 'gemini'] },
      { n: 'claude', d: 'Claude', c: 'AI_SERVICES', p: [
        { name: 'Pro', priceMonthly: 20, currency: 'USD' },
        { name: 'Max', priceMonthly: 100, currency: 'USD' },
      ], a: ['chatgpt', 'gemini'] },
      { n: 'midjourney', d: 'Midjourney', c: 'AI_SERVICES', p: [
        { name: 'Basic', priceMonthly: 10, currency: 'USD' },
        { name: 'Standard', priceMonthly: 30, currency: 'USD' },
        { name: 'Pro', priceMonthly: 60, currency: 'USD' },
      ], a: ['dall_e', 'stable_diffusion'] },
      { n: 'github_copilot', d: 'GitHub Copilot', c: 'AI_SERVICES', p: [
        { name: 'Individual', priceMonthly: 10, currency: 'USD' },
        { name: 'Business', priceMonthly: 19, currency: 'USD' },
      ], a: ['cursor', 'codeium'] },
      { n: 'cursor', d: 'Cursor', c: 'AI_SERVICES', p: [
        { name: 'Pro', priceMonthly: 20, currency: 'USD' },
        { name: 'Business', priceMonthly: 40, currency: 'USD' },
      ], a: ['github_copilot', 'codeium'] },
      { n: 'notion', d: 'Notion', c: 'PRODUCTIVITY', p: [
        { name: 'Plus', priceMonthly: 10, currency: 'USD' },
        { name: 'Business', priceMonthly: 15, currency: 'USD' },
      ], a: ['obsidian', 'coda'] },
      { n: 'figma', d: 'Figma', c: 'DESIGN', p: [
        { name: 'Professional', priceMonthly: 12, currency: 'USD' },
        { name: 'Organization', priceMonthly: 45, currency: 'USD' },
      ], a: ['sketch', 'adobe_xd'] },
      { n: 'slack', d: 'Slack', c: 'PRODUCTIVITY', p: [
        { name: 'Pro', priceMonthly: 7.25, currency: 'USD' },
        { name: 'Business+', priceMonthly: 12.50, currency: 'USD' },
      ], a: ['microsoft_teams', 'discord'] },
      { n: 'adobe_creative_cloud', d: 'Adobe Creative Cloud', c: 'DESIGN', p: [
        { name: 'Photography', priceMonthly: 9.99, currency: 'USD' },
        { name: 'Single App', priceMonthly: 22.99, currency: 'USD' },
        { name: 'All Apps', priceMonthly: 59.99, currency: 'USD' },
      ], a: ['canva', 'figma', 'affinity'] },
      { n: 'digitalocean', d: 'DigitalOcean', c: 'INFRASTRUCTURE', p: [
        { name: 'Basic Droplet', priceMonthly: 4, currency: 'USD' },
        { name: 'Standard Droplet', priceMonthly: 6, currency: 'USD' },
      ], a: ['hetzner', 'vultr', 'linode'] },
      { n: 'vercel', d: 'Vercel', c: 'INFRASTRUCTURE', p: [
        { name: 'Pro', priceMonthly: 20, currency: 'USD' },
      ], a: ['netlify', 'cloudflare_pages'] },
      { n: 'xbox_game_pass', d: 'Xbox Game Pass', c: 'GAMING', p: [
        { name: 'Core', priceMonthly: 9.99, currency: 'USD' },
        { name: 'Standard', priceMonthly: 14.99, currency: 'USD' },
        { name: 'Ultimate', priceMonthly: 19.99, currency: 'USD' },
      ], a: ['playstation_plus', 'nintendo_online'] },
      { n: 'playstation_plus', d: 'PlayStation Plus', c: 'GAMING', p: [
        { name: 'Essential', priceMonthly: 9.99, currency: 'USD' },
        { name: 'Extra', priceMonthly: 14.99, currency: 'USD' },
        { name: 'Premium', priceMonthly: 17.99, currency: 'USD' },
      ], a: ['xbox_game_pass'] },
    ];

    for (const s of services) {
      await queryRunner.query(
        `INSERT INTO "service_catalog" ("normalizedName", "displayName", "category", "plans", "alternatives", "source", "lastVerifiedAt")
         VALUES ($1, $2, $3, $4, $5, 'HARDCODED', NOW())
         ON CONFLICT ("normalizedName") DO NOTHING`,
        [s.n, s.d, s.c, JSON.stringify(s.p), JSON.stringify(s.a)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "service_catalog" WHERE "source" = 'HARDCODED'`);
  }
}
