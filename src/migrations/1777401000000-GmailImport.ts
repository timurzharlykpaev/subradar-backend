import { MigrationInterface, QueryRunner } from 'typeorm';

const SEED: Array<{
  domain: string;
  emailPattern: string | null;
  service: string;
  category: string;
}> = [
  { domain: 'netflix.com', emailPattern: null, service: 'Netflix', category: 'STREAMING' },
  { domain: 'spotify.com', emailPattern: null, service: 'Spotify', category: 'MUSIC' },
  { domain: 'apple.com', emailPattern: 'no_reply@email.apple.com', service: 'Apple', category: 'OTHER' },
  { domain: 'youtube.com', emailPattern: null, service: 'YouTube Premium', category: 'STREAMING' },
  { domain: 'openai.com', emailPattern: null, service: 'ChatGPT Plus', category: 'AI_SERVICES' },
  { domain: 'anthropic.com', emailPattern: null, service: 'Claude Pro', category: 'AI_SERVICES' },
  { domain: 'adobe.com', emailPattern: null, service: 'Adobe Creative Cloud', category: 'PRODUCTIVITY' },
  { domain: 'notion.so', emailPattern: null, service: 'Notion', category: 'PRODUCTIVITY' },
  { domain: 'figma.com', emailPattern: null, service: 'Figma', category: 'PRODUCTIVITY' },
  { domain: 'github.com', emailPattern: null, service: 'GitHub', category: 'INFRASTRUCTURE' },
  { domain: 'vercel.com', emailPattern: null, service: 'Vercel', category: 'INFRASTRUCTURE' },
  { domain: 'cloudflare.com', emailPattern: null, service: 'Cloudflare', category: 'INFRASTRUCTURE' },
  { domain: 'google.com', emailPattern: 'payments-noreply@google.com', service: 'Google One', category: 'INFRASTRUCTURE' },
  { domain: 'microsoft.com', emailPattern: null, service: 'Microsoft 365', category: 'PRODUCTIVITY' },
  { domain: '1password.com', emailPattern: null, service: '1Password', category: 'INFRASTRUCTURE' },
  { domain: 'dropbox.com', emailPattern: null, service: 'Dropbox', category: 'INFRASTRUCTURE' },
  { domain: 'zoom.us', emailPattern: null, service: 'Zoom', category: 'PRODUCTIVITY' },
  { domain: 'slack.com', emailPattern: null, service: 'Slack', category: 'PRODUCTIVITY' },
  { domain: 'linear.app', emailPattern: null, service: 'Linear', category: 'PRODUCTIVITY' },
  { domain: 'asana.com', emailPattern: null, service: 'Asana', category: 'PRODUCTIVITY' },
  { domain: 'monday.com', emailPattern: null, service: 'Monday.com', category: 'PRODUCTIVITY' },
  { domain: 'clickup.com', emailPattern: null, service: 'ClickUp', category: 'PRODUCTIVITY' },
  { domain: 'stripe.com', emailPattern: null, service: 'Stripe', category: 'INFRASTRUCTURE' },
  { domain: 'supabase.com', emailPattern: null, service: 'Supabase', category: 'INFRASTRUCTURE' },
  { domain: 'render.com', emailPattern: null, service: 'Render', category: 'INFRASTRUCTURE' },
  { domain: 'heroku.com', emailPattern: null, service: 'Heroku', category: 'INFRASTRUCTURE' },
  { domain: 'digitalocean.com', emailPattern: null, service: 'DigitalOcean', category: 'INFRASTRUCTURE' },
  { domain: 'aws.amazon.com', emailPattern: null, service: 'AWS', category: 'INFRASTRUCTURE' },
  { domain: 'amazon.com', emailPattern: 'auto-confirm@amazon.com', service: 'Amazon Prime', category: 'STREAMING' },
  { domain: 'disneyplus.com', emailPattern: null, service: 'Disney+', category: 'STREAMING' },
  { domain: 'hbomax.com', emailPattern: null, service: 'HBO Max', category: 'STREAMING' },
  { domain: 'max.com', emailPattern: null, service: 'Max', category: 'STREAMING' },
  { domain: 'hulu.com', emailPattern: null, service: 'Hulu', category: 'STREAMING' },
  { domain: 'paramount.com', emailPattern: null, service: 'Paramount+', category: 'STREAMING' },
  { domain: 'peacocktv.com', emailPattern: null, service: 'Peacock', category: 'STREAMING' },
  { domain: 'twitch.tv', emailPattern: null, service: 'Twitch', category: 'STREAMING' },
  { domain: 'patreon.com', emailPattern: null, service: 'Patreon', category: 'OTHER' },
  { domain: 'substack.com', emailPattern: null, service: 'Substack', category: 'NEWS' },
  { domain: 'medium.com', emailPattern: null, service: 'Medium', category: 'NEWS' },
  { domain: 'nytimes.com', emailPattern: null, service: 'New York Times', category: 'NEWS' },
  { domain: 'wsj.com', emailPattern: null, service: 'Wall Street Journal', category: 'NEWS' },
  { domain: 'ft.com', emailPattern: null, service: 'Financial Times', category: 'NEWS' },
  { domain: 'the-economist.com', emailPattern: null, service: 'The Economist', category: 'NEWS' },
  { domain: 'wired.com', emailPattern: null, service: 'Wired', category: 'NEWS' },
  { domain: 'nordvpn.com', emailPattern: null, service: 'NordVPN', category: 'INFRASTRUCTURE' },
  { domain: 'expressvpn.com', emailPattern: null, service: 'ExpressVPN', category: 'INFRASTRUCTURE' },
  { domain: 'protonmail.com', emailPattern: null, service: 'Proton Mail', category: 'INFRASTRUCTURE' },
  { domain: 'protonvpn.com', emailPattern: null, service: 'Proton VPN', category: 'INFRASTRUCTURE' },
  { domain: 'headspace.com', emailPattern: null, service: 'Headspace', category: 'HEALTH' },
  { domain: 'calm.com', emailPattern: null, service: 'Calm', category: 'HEALTH' },
  { domain: 'duolingo.com', emailPattern: null, service: 'Duolingo Plus', category: 'PRODUCTIVITY' },
  { domain: 'audible.com', emailPattern: null, service: 'Audible', category: 'OTHER' },
  { domain: 'scribd.com', emailPattern: null, service: 'Scribd', category: 'OTHER' },
  { domain: 'playstation.com', emailPattern: null, service: 'PlayStation Plus', category: 'GAMING' },
  { domain: 'xbox.com', emailPattern: null, service: 'Xbox Game Pass', category: 'GAMING' },
  { domain: 'nintendo.com', emailPattern: null, service: 'Nintendo Switch Online', category: 'GAMING' },
  { domain: 'epicgames.com', emailPattern: null, service: 'Epic Games', category: 'GAMING' },
  { domain: 'ea.com', emailPattern: null, service: 'EA Play', category: 'GAMING' },
  { domain: 'ubisoft.com', emailPattern: null, service: 'Ubisoft+', category: 'GAMING' },
  { domain: 'discordapp.com', emailPattern: null, service: 'Discord Nitro', category: 'OTHER' },
  { domain: 'midjourney.com', emailPattern: null, service: 'Midjourney', category: 'AI_SERVICES' },
  { domain: 'perplexity.ai', emailPattern: null, service: 'Perplexity Pro', category: 'AI_SERVICES' },
  { domain: 'elevenlabs.io', emailPattern: null, service: 'ElevenLabs', category: 'AI_SERVICES' },
  { domain: 'runwayml.com', emailPattern: null, service: 'Runway', category: 'AI_SERVICES' },
  { domain: 'replicate.com', emailPattern: null, service: 'Replicate', category: 'AI_SERVICES' },
  { domain: 'huggingface.co', emailPattern: null, service: 'Hugging Face', category: 'AI_SERVICES' },
  { domain: 'yandex.ru', emailPattern: null, service: 'Yandex Plus', category: 'STREAMING' },
  { domain: 'kinopoisk.ru', emailPattern: null, service: 'Kinopoisk', category: 'STREAMING' },
  { domain: 'okko.tv', emailPattern: null, service: 'Okko', category: 'STREAMING' },
  { domain: 'ivi.ru', emailPattern: null, service: 'ivi', category: 'STREAMING' },
  { domain: 'wink.ru', emailPattern: null, service: 'Wink', category: 'STREAMING' },
  { domain: 'sber.ru', emailPattern: null, service: 'СберПрайм', category: 'OTHER' },
  { domain: 't-bank.ru', emailPattern: null, service: 'Тинькофф Pro', category: 'OTHER' },
];

export class GmailImport1777401000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS gmail_connected_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS gmail_last_scan_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS gmail_last_import_count INT NULL
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS known_billing_senders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain VARCHAR(255) NOT NULL,
        email_pattern VARCHAR(255) NULL,
        service_name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        default_currency VARCHAR(3) NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        added_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await qr.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_known_senders_domain_pattern'
        ) THEN
          ALTER TABLE known_billing_senders
            ADD CONSTRAINT uq_known_senders_domain_pattern UNIQUE NULLS NOT DISTINCT (domain, email_pattern);
        END IF;
      END $$;
    `);

    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_known_senders_active
         ON known_billing_senders(active) WHERE active = TRUE`,
    );

    for (const row of SEED) {
      await qr.query(
        `INSERT INTO known_billing_senders (domain, email_pattern, service_name, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_known_senders_domain_pattern DO NOTHING`,
        [row.domain, row.emailPattern, row.service, row.category],
      );
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_known_senders_active`);
    await qr.query(`DROP TABLE IF EXISTS known_billing_senders`);
    await qr.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS gmail_connected_at,
        DROP COLUMN IF EXISTS gmail_last_scan_at,
        DROP COLUMN IF EXISTS gmail_last_import_count
    `);
  }
}
