import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import Redis from 'ioredis';

@Injectable()
export class AiService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly redis: Redis;
  private activeRequests = 0;
  private readonly maxConcurrency = 3;
  private readonly waitQueue: (() => void)[] = [];

  constructor(private readonly cfg: ConfigService) {
    this.openai = new OpenAI({ apiKey: cfg.get('OPENAI_API_KEY') });
    this.model = cfg.get('OPENAI_MODEL', 'gpt-4o');
    this.redis = new Redis(cfg.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests++;
      return;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.indexOf(fn);
        if (idx > -1) this.waitQueue.splice(idx, 1);
        reject(new Error('AI service busy, try again later'));
      }, 30000);

      const fn = () => {
        clearTimeout(timer);
        this.activeRequests++;
        resolve();
      };
      this.waitQueue.push(fn);
    });
  }

  private releaseSlot(): void {
    this.activeRequests--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  private async chat(
    messages: OpenAI.ChatCompletionMessageParam[],
    jsonMode = true,
  ) {
    await this.acquireSlot();
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        temperature: 0.2,
      }, { timeout: 30000 });
      const content = response.choices[0].message.content || '{}';
      if (!jsonMode) return content;
      try {
        return JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { return JSON.parse(match[0]); } catch { /* fall through */ }
        }
        return {};
      }
    } finally {
      this.releaseSlot();
    }
  }

  async lookupService(query: string, locale = 'en', country = 'US') {
    const cacheKey = `ai:lookup:${query}:${locale}:${country}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.chat([
      {
        role: 'system',
        content: `You are a subscription service lookup assistant with deep knowledge of SaaS pricing.

Return JSON with fields:
- name: official service name
- serviceUrl: official website URL
- cancelUrl: direct cancellation URL (not generic help page)
- category: one of STREAMING/AI_SERVICES/INFRASTRUCTURE/PRODUCTIVITY/MUSIC/GAMING/NEWS/HEALTH/OTHER
- plans: array of { name, price (number), currency (3-letter ISO), period (MONTHLY/YEARLY) }
  Include ALL known plans (free tier excluded). Use the most current pricing you know.
- priceNote: string — if you are confident the price is current (within last 6 months), say "Current as of [date]". If uncertain, say "Price may have changed — verify at [serviceUrl]".

Locale: ${locale}, Country: ${country}.
IMPORTANT: Always return at least one plan with a non-zero price for paid services.`,
      },
      {
        role: 'user',
        content: `Look up subscription service: "${query}"`,
      },
    ]);

    // Generate reliable iconUrl from serviceUrl using Clearbit Logo API
    if (result && result.serviceUrl) {
      try {
        const hostname = new URL(result.serviceUrl).hostname.replace(/^www\./, '');
        result.iconUrl = `https://icon.horse/icon/${hostname}`;
      } catch {
        // fallback to Google favicons
        result.iconUrl = `https://www.google.com/s2/favicons?domain=${result.serviceUrl}&sz=128`;
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
    return result;
  }

  async parseScreenshot(imageBase64: string) {
    await this.acquireSlot();
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a receipt/subscription screenshot parser. Extract subscription details and return JSON with: name, amount, currency, billingPeriod (MONTHLY/YEARLY/WEEKLY/QUARTERLY/LIFETIME/ONE_TIME), date (ISO string), planName.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Parse this subscription screenshot:' },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }, { timeout: 30000 });
      return JSON.parse(response.choices[0].message.content || '{}');
    } finally {
      this.releaseSlot();
    }
  }

  async voiceToSubscription(audioBase64: string, locale = 'en') {
    // First transcribe audio (counts as one OpenAI slot)
    await this.acquireSlot();
    let text: string;
    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      // Detect format: m4a starts with ftyp box (bytes 4-7), mp3 starts with ID3/FF
      let mimeType = 'audio/mp4';
      let fileName = 'audio.m4a';
      if (audioBuffer.length > 4) {
        const header = audioBuffer.slice(0, 4).toString('hex');
        if (header.startsWith('1a45')) { mimeType = 'audio/webm'; fileName = 'audio.webm'; }
        else if (header.startsWith('494433') || header.startsWith('fffb') || header.startsWith('fff3')) { mimeType = 'audio/mpeg'; fileName = 'audio.mp3'; }
        else if (header.startsWith('4f676753')) { mimeType = 'audio/ogg'; fileName = 'audio.ogg'; }
      }
      const audioFile = await toFile(audioBuffer, fileName, { type: mimeType });

      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: locale.split('-')[0],
      }, { timeout: 30000 });
      text = transcription.text;
    } finally {
      this.releaseSlot();
    }

    // Then parse subscription details from transcript (chat() acquires its own slot)
    return this.chat([
      {
        role: 'system',
        content:
          'You are a subscription data extractor. From the voice transcript, extract subscription fields and return JSON with: name, amount, currency, billingPeriod, category, notes, startDate.',
      },
      { role: 'user', content: `Voice transcript: "${text}"` },
    ]);
  }

  /**
   * Transcribe audio only — return { text } without parsing subscription.
   * Used by mobile AIWizard which sends transcript to wizard endpoint separately.
   */
  async transcribeAudio(audioBase64: string, locale = 'en'): Promise<{ text: string }> {
    if (!audioBase64) return { text: '' };
    await this.acquireSlot();
    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      if (audioBuffer.length < 100) return { text: '' };

      let mimeType = 'audio/mp4';
      let fileName = 'audio.m4a';
      if (audioBuffer.length > 4) {
        const header = audioBuffer.slice(0, 4).toString('hex');
        if (header.startsWith('1a45')) { mimeType = 'audio/webm'; fileName = 'audio.webm'; }
        else if (header.startsWith('494433') || header.startsWith('fffb') || header.startsWith('fff3')) { mimeType = 'audio/mpeg'; fileName = 'audio.mp3'; }
        else if (header.startsWith('4f676753')) { mimeType = 'audio/ogg'; fileName = 'audio.ogg'; }
      }
      const audioFile = await toFile(audioBuffer, fileName, { type: mimeType });

      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: locale.split('-')[0],
      }, { timeout: 30000 });
      return { text: transcription.text || '' };
    } catch (err) {
      console.error('Whisper transcription error:', err);
      return { text: '' };
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Parse MULTIPLE subscriptions from free-form text or voice transcript.
   * Returns array of subscription objects.
   * E.g. "У меня Netflix за 15 долларов, Spotify 10 евро в месяц и iCloud 3 доллара"
   */
  async parseBulkSubscriptions(text: string, locale = 'en') {
    return this.chat([
      {
        role: 'system',
        content: `You are a bulk subscription extractor. The user describes one or more subscriptions in free text or voice. Extract ALL subscriptions mentioned and return a strict JSON array (never an object): [ { "name": string, "amount": number, "currency": "USD"|"EUR"|..., "billingPeriod": "MONTHLY"|"YEARLY"|"WEEKLY"|"QUARTERLY", "category": "STREAMING"|"AI_SERVICES"|"INFRASTRUCTURE"|"PRODUCTIVITY"|"MUSIC"|"GAMING"|"NEWS"|"HEALTH"|"OTHER", "serviceUrl": string|null, "iconUrl": "https://icon.horse/icon/{domain}" } ]. Rules: 1) ALWAYS return an array, even for 1 item. 2) Include iconUrl using icon.horse with the service domain. 3) Use realistic prices. 4) If the user mentions a service without specifying a plan, use the most popular plan. Locale: ${locale}.`,
      },
      {
        role: 'user',
        content: text.slice(0, 4000),
      },
    ]);
  }

  /**
   * Transcribe audio and parse multiple subscriptions from it.
   */
  async voiceToBulkSubscriptions(audioBase64: string, locale = 'en') {
    await this.acquireSlot();
    let text: string;
    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      let mimeType2 = 'audio/mp4'; let fileName2 = 'audio.m4a';
      if (audioBuffer.length > 4) {
        const h = audioBuffer.slice(0, 4).toString('hex');
        if (h.startsWith('1a45')) { mimeType2 = 'audio/webm'; fileName2 = 'audio.webm'; }
        else if (h.startsWith('4f676753')) { mimeType2 = 'audio/ogg'; fileName2 = 'audio.ogg'; }
      }
      const audioFile = await toFile(audioBuffer, fileName2, { type: mimeType2 });
      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: locale.split('-')[0],
      }, { timeout: 30000 });
      text = transcription.text;
    } finally {
      this.releaseSlot();
    }
    const result = await this.parseBulkSubscriptions(text, locale);
    return { text, subscriptions: Array.isArray(result) ? result : [result] };
  }

  /** Parse subscription details from email/receipt text */
  async parseEmailText(text: string) {
    return this.chat([
      {
        role: 'system',
        content: 'You are a subscription parser. Extract subscription info from the given email/receipt text. Return JSON: { name, amount (number), currency, billingPeriod (MONTHLY/YEARLY/WEEKLY/QUARTERLY), category (STREAMING/AI_SERVICES/INFRASTRUCTURE/PRODUCTIVITY/MUSIC/GAMING/NEWS/HEALTH/OTHER), nextPaymentDate (ISO string or null) }. If not a subscription email, return {}.',
      },
      {
        role: 'user',
        content: text.slice(0, 3000),
      },
    ]);
  }

  /**
   * Conversational wizard — one endpoint drives the whole dialog.
   * Returns { done, subscription } OR { done: false, question, field, partialContext }
   */
  async wizard(
    message: string,
    context: Record<string, any> = {},
    locale = 'en',
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ) {
    const preferredCurrency = context.preferredCurrency as string | undefined;
    const currencyNote = preferredCurrency && preferredCurrency !== 'USD'
      ? `\nUser's preferred currency: ${preferredCurrency}. If you know the price in ${preferredCurrency}, use it. Otherwise use USD and note the currency.`
      : '';
    const cleanContext = { ...context };
    delete cleanContext.preferredCurrency;
    const contextStr = Object.keys(cleanContext).length
      ? `\nAccumulated context so far: ${JSON.stringify(cleanContext)}`
      : '';

    const systemMsg = {
      role: 'system' as const,
      content: `You are a precise subscription tracking assistant. Extract subscription details accurately.

PRICING DATABASE (use EXACT prices, do not invent):

🎬 STREAMING & MEDIA:
- YouTube Premium: $13.99/mo (individual), $22.99/mo (family) | youtube.com | STREAMING
- Netflix: Standard with Ads $7.99/mo, Standard $15.49/mo, Premium $22.99/mo | netflix.com | STREAMING
- Disney+: Basic $7.99/mo, Premium $13.99/mo | disneyplus.com | STREAMING
- Hulu: With Ads $7.99/mo, No Ads $17.99/mo | hulu.com | STREAMING
- Apple TV+: $9.99/mo | tv.apple.com | STREAMING
- Amazon Prime Video: $8.99/mo or included in Prime | amazon.com | STREAMING
- Amazon Prime: $14.99/mo or $139/yr (includes Video+Music+Shipping) | amazon.com | STREAMING
- Twitch Turbo: $8.99/mo | twitch.tv | STREAMING
- Crunchyroll: Fan $7.99/mo, Mega Fan $9.99/mo, Ultimate $14.99/mo | crunchyroll.com | STREAMING

🎵 MUSIC:
- Spotify: Premium $11.99/mo, Duo $16.99/mo, Family $19.99/mo | spotify.com | MUSIC
- Apple Music: Individual $10.99/mo, Student $5.99/mo, Family $16.99/mo | music.apple.com | MUSIC
- YouTube Music: Individual $10.99/mo, Family $16.99/mo | music.youtube.com | MUSIC
- Tidal: Individual $10.99/mo, HiFi Plus $19.99/mo, Family $14.99/mo | tidal.com | MUSIC
- Deezer: Individual $10.99/mo, Family $17.99/mo | deezer.com | MUSIC

🤖 AI SERVICES:
- ChatGPT Plus: $20/mo | chat.openai.com | AI_SERVICES
- ChatGPT Pro: $200/mo | chat.openai.com | AI_SERVICES
- Claude Pro: $20/mo | claude.ai | AI_SERVICES
- Claude Max: $100/mo | claude.ai | AI_SERVICES
- Midjourney: Basic $10/mo, Standard $30/mo, Pro $60/mo | midjourney.com | AI_SERVICES
- Gemini Advanced: $19.99/mo | gemini.google.com | AI_SERVICES
- Perplexity Pro: $20/mo | perplexity.ai | AI_SERVICES
- Cursor Pro: $20/mo | cursor.com | AI_SERVICES
- GitHub Copilot: Individual $10/mo, Business $19/mo, Enterprise $39/mo | github.com | AI_SERVICES

💼 PRODUCTIVITY:
- LinkedIn Premium Career: $39.99/mo | Business: $59.99/mo | Sales Navigator Core: $99.99/mo | linkedin.com | PRODUCTIVITY
- Notion: Plus $10/mo, Business $15/mo, AI add-on $8/mo | notion.so | PRODUCTIVITY
- Figma: Starter free, Professional $12/mo, Organization $45/mo | figma.com | PRODUCTIVITY
- Adobe Creative Cloud: All Apps $59.99/mo, Photography $19.99/mo, Acrobat $22.99/mo | adobe.com | PRODUCTIVITY
- Microsoft 365: Personal $6.99/mo, Family $9.99/mo, Business Basic $6/mo | microsoft.com | PRODUCTIVITY
- Slack: Pro $7.25/mo, Business+ $12.50/mo | slack.com | PRODUCTIVITY
- Zoom: Pro $13.32/mo, Business $18.32/mo | zoom.us | PRODUCTIVITY
- Loom: Business $12.50/mo | loom.com | PRODUCTIVITY
- Canva: Pro $14.99/mo, Teams $29.99/mo | canva.com | PRODUCTIVITY
- Grammarly: Premium $12/mo, Business $15/mo | grammarly.com | PRODUCTIVITY

☁️ INFRASTRUCTURE (для разработчиков):
- DigitalOcean Droplet: Basic $4/mo (512MB), Standard $6/mo (1GB), $12/mo (2GB), $24/mo (4GB) | digitalocean.com | INFRASTRUCTURE
- DigitalOcean App Platform: Basic $5/mo, Professional $12/mo | digitalocean.com | INFRASTRUCTURE
- DigitalOcean Managed DB: PostgreSQL from $15/mo | digitalocean.com | INFRASTRUCTURE
- AWS EC2: t3.micro $0.0104/hr (~$7.5/mo), t3.small $0.0208/hr (~$15/mo) | aws.amazon.com | INFRASTRUCTURE
- AWS RDS: db.t3.micro $14.46/mo | aws.amazon.com | INFRASTRUCTURE
- AWS S3: $0.023/GB/mo | aws.amazon.com | INFRASTRUCTURE
- Google Cloud (GCP): e2-micro free tier, e2-small $13.85/mo | cloud.google.com | INFRASTRUCTURE
- Vercel: Pro $20/mo, Team $20/mo per member | vercel.com | INFRASTRUCTURE
- Netlify: Pro $19/mo | netlify.com | INFRASTRUCTURE
- Heroku: Eco $5/mo, Basic $7/mo, Standard $25/mo | heroku.com | INFRASTRUCTURE
- Railway: Hobby $5/mo, Pro $20/mo | railway.app | INFRASTRUCTURE
- Render: Individual $7/mo, Team $20/mo | render.com | INFRASTRUCTURE
- Cloudflare: Pro $20/mo, Business $200/mo | cloudflare.com | INFRASTRUCTURE
- Cloudflare Workers: Free 100k/day, Paid $5/mo | cloudflare.com | INFRASTRUCTURE
- GitHub: Free, Team $4/mo, Enterprise $21/mo | github.com | INFRASTRUCTURE
- GitLab: Premium $29/mo, Ultimate $99/mo | gitlab.com | INFRASTRUCTURE
- Sentry: Team $26/mo, Business $80/mo | sentry.io | INFRASTRUCTURE
- Datadog: Pro $15/host/mo, Enterprise $23/host/mo | datadoghq.com | INFRASTRUCTURE
- New Relic: Full platform $99/mo | newrelic.com | INFRASTRUCTURE
- MongoDB Atlas: Serverless from $0, Dedicated M10 $57/mo | mongodb.com | INFRASTRUCTURE
- PlanetScale: Hobby free, Scaler $39/mo | planetscale.com | INFRASTRUCTURE
- Supabase: Pro $25/mo | supabase.com | INFRASTRUCTURE
- Firebase Blaze: pay-as-you-go, typically $25-100/mo | firebase.google.com | INFRASTRUCTURE
- Twilio: pay-as-you-go, ~$1/mo base | twilio.com | INFRASTRUCTURE
- SendGrid: Essentials $19.95/mo, Pro $89.95/mo | sendgrid.com | INFRASTRUCTURE
- Resend: Pro $20/mo | resend.com | INFRASTRUCTURE
- Postmark: Developer $15/mo | postmarkapp.com | INFRASTRUCTURE
- Stripe: 2.9%+30¢ per transaction (no subscription fee) | stripe.com | INFRASTRUCTURE
💾 STORAGE & CLOUD:
- Apple iCloud+: 50GB $0.99/mo, 200GB $2.99/mo, 2TB $9.99/mo | icloud.com | INFRASTRUCTURE
- Google One: 100GB $1.99/mo, 200GB $2.99/mo, 2TB $9.99/mo | one.google.com | INFRASTRUCTURE
- Dropbox: Plus $11.99/mo, Essentials $22/mo, Business $18/mo | dropbox.com | INFRASTRUCTURE
- Box: Personal Pro $10/mo, Business $15/mo | box.com | INFRASTRUCTURE

📚 EDUCATION:
- Coursera: Plus $59/mo, Coursera for Teams $399/yr per seat | coursera.org | EDUCATION
- Udemy Business: $360/yr per seat | udemy.com | EDUCATION
- Duolingo Plus: $6.99/mo | duolingo.com | EDUCATION
- MasterClass: Individual $10/mo, Duo $15/mo | masterclass.com | EDUCATION
- LinkedIn Learning: $29.99/mo | linkedin.com/learning | EDUCATION
- Skillshare: Individual $14/mo | skillshare.com | EDUCATION

💰 FINANCE:
- YNAB: $14.99/mo or $99/yr | ynab.com | FINANCE
- QuickBooks Simple Start: $30/mo, Essentials: $60/mo | quickbooks.com | FINANCE
- Xero: Starter $13/mo, Standard $37/mo | xero.com | FINANCE
- TradingView: Essential $12.95/mo, Plus $24.95/mo, Premium $49.95/mo | tradingview.com | FINANCE
- Expensify: Collect $5/mo/user | expensify.com | FINANCE

🔒 SECURITY:
- 1Password: Individual $2.99/mo, Family $4.99/mo, Teams $19.95/mo | 1password.com | SECURITY
- NordVPN: Standard $3.99/mo (yearly), Plus $5.49/mo | nordvpn.com | SECURITY
- ExpressVPN: $8.32/mo (yearly plan) | expressvpn.com | SECURITY
- Dashlane: Premium $4.99/mo | dashlane.com | SECURITY
- Bitwarden: Premium $0.83/mo, Families $3.33/mo | bitwarden.com | SECURITY
- LastPass: Premium $3/mo, Families $4/mo | lastpass.com | SECURITY

🏃 SPORT:
- Strava: Summit $11.99/mo or $59.99/yr | strava.com | SPORT
- Peloton App: $12.99/mo | onepeloton.com | SPORT
- MyFitnessPal Premium: $9.99/mo | myfitnesspal.com | SPORT
- Headspace: $12.99/mo, Family $19.99/mo | headspace.com | SPORT
- Calm: $14.99/mo or $69.99/yr | calm.com | SPORT

💼 BUSINESS:
- Jira: Standard $7.53/mo per user, Premium $13.53/mo | atlassian.com | BUSINESS
- Asana: Starter $10.99/mo, Advanced $24.99/mo | asana.com | BUSINESS
- Monday.com: Basic $9/mo, Standard $12/mo | monday.com | BUSINESS
- Notion (business): $15/mo per member | notion.so | BUSINESS
- HubSpot Starter: $18/mo, Professional $800/mo | hubspot.com | BUSINESS
- Salesforce: Essentials $25/mo per user | salesforce.com | BUSINESS
- Intercom: Essential $39/mo | intercom.com | BUSINESS

👨‍💻 DEVELOPER:
- JetBrains All Products: $24.90/mo | jetbrains.com | DEVELOPER
- Linear: Plus $8/mo per user | linear.app | DEVELOPER
- Postman: Basic $14/mo, Professional $29/mo | postman.com | DEVELOPER
- Retool: Free, Team $10/mo per user | retool.com | DEVELOPER
- Segment: Developer free, Team $120/mo | segment.com | DEVELOPER

CRITICAL RULES (follow strictly):
1. Use EXACT prices from the database above. NEVER guess or ask about prices for known services.
2. If user specifies an EXACT plan name (e.g. "LinkedIn Premium Career", "Netflix Premium", "Spotify Family") → return single subscription immediately with that plan's exact price (schema A).
3. If user names a SERVICE with MULTIPLE tiers but NOT a specific plan → return "plans" array (schema B). NEVER ask "which plan?", show options instead.
4. For single-plan services → return single "subscription" (schema A).
5. If service is NOT in the database above:
   a) Ask the user for price AND billing period AND category. Example question: "Сколько стоит подписка X и как часто оплачивается? (ежемесячно/ежегодно)"
   b) NEVER guess the price for unknown services.
   c) NEVER auto-assign category for unknown services — ask: "К какой категории отнести? (Стриминг, Музыка, AI, Продуктивность, Другое)"
   d) If user provides partial info (e.g. only name), ask for the missing fields step by step.
6. Always include iconUrl: https://icon.horse/icon/{domain}
7. Return ONLY valid JSON. No markdown. No explanation.
8. If you recognize the service name but it's not in the pricing database, use web search knowledge but STILL confirm the price with the user.

EXAMPLE — user says "LinkedIn Premium Career" (specific plan → schema A):
{"done":true,"subscription":{"name":"LinkedIn Premium Career","amount":39.99,"currency":"USD","billingPeriod":"MONTHLY","category":"PRODUCTIVITY","serviceUrl":"https://linkedin.com/premium","cancelUrl":"https://linkedin.com/premium/cancel","iconUrl":"https://icon.horse/icon/linkedin.com"}}

EXAMPLE — user says "LinkedIn" or "LinkedIn Premium" (ambiguous → schema B):
{"done":true,"plans":[{"name":"LinkedIn Premium Career","amount":39.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"LinkedIn Premium Business","amount":59.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"LinkedIn Sales Navigator","amount":99.99,"billingPeriod":"MONTHLY","currency":"USD"}],"serviceName":"LinkedIn Premium","iconUrl":"https://icon.horse/icon/linkedin.com","serviceUrl":"https://linkedin.com/premium","cancelUrl":"https://linkedin.com/premium/cancel","category":"PRODUCTIVITY"}

EXAMPLE — user says "Netflix" (ambiguous → schema B):
{"done":true,"plans":[{"name":"Netflix Standard with Ads","amount":7.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"Netflix Standard","amount":15.49,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"Netflix Premium","amount":22.99,"billingPeriod":"MONTHLY","currency":"USD"}],"serviceName":"Netflix","iconUrl":"https://icon.horse/icon/netflix.com","serviceUrl":"https://netflix.com","cancelUrl":"https://netflix.com/cancelplan","category":"STREAMING"}

EXAMPLE — user says "ChatGPT Plus" (specific → schema A):
{"done":true,"subscription":{"name":"ChatGPT Plus","amount":20.00,"currency":"USD","billingPeriod":"MONTHLY","category":"AI_SERVICES","serviceUrl":"https://chat.openai.com","cancelUrl":"https://help.openai.com","iconUrl":"https://icon.horse/icon/openai.com"}}

Valid categories: STREAMING, AI_SERVICES, INFRASTRUCTURE, PRODUCTIVITY, MUSIC, GAMING, NEWS, HEALTH, EDUCATION, FINANCE, SECURITY, DEVELOPER, SPORT, BUSINESS, OTHER

Response schemas:
A) Single plan: { "done": true, "subscription": { "name": string, "amount": number, "currency": "USD", "billingPeriod": "MONTHLY"|"YEARLY", "category": string, "serviceUrl": string, "cancelUrl": string|null, "iconUrl": string } }
B) Multiple plans: { "done": true, "plans": [{ "name": string, "amount": number, "billingPeriod": "MONTHLY"|"YEARLY", "currency": "USD" }], "serviceName": string, "iconUrl": string, "serviceUrl": string, "cancelUrl": string|null, "category": string }
C) Need info: { "done": false, "question": string, "field": "name"|"amount"|"period"|"clarify", "partialContext": {} }

LANGUAGE: Always write the "question" field in the user's language. User locale is "${locale}". If locale starts with "ru" → write question in Russian. If "de" → German. If "es" → Spanish. Otherwise English.${currencyNote}${contextStr}`,
    };

    // Build messages: system + history + current user message
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      systemMsg,
      ...history.slice(-8).map((h) => ({ role: h.role, content: h.content.slice(0, 500) })),
      { role: 'user', content: message.slice(0, 1000) },
    ];

    // Try chat with built-in knowledge first
    const result = await this.chat(messages);

    if (typeof result === 'object' && result !== null) {
      // If GPT returned a question (doesn't know the service), try web search to find pricing
      if (result.done === false && result.question) {
        const webResult = await this.wizardWithWebSearch(message, systemMsg.content, locale);
        if (webResult) return webResult;
      }
      // Ensure iconUrl is always set for completed responses
      if (result.done === true) {
        this.ensureIconUrl(result.subscription ?? result);
        if (result.plans) { this.ensureIconUrl(result); }
      }
      return result;
    }
    try { return JSON.parse(String(result)); } catch { return { done: false, question: locale.startsWith('ru') ? 'Какой это сервис?' : 'What service is this?', field: 'name', partialContext: {} }; }
  }

  /** Ensure iconUrl is set on any object that has serviceUrl or name */
  private ensureIconUrl(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    if (obj.iconUrl) return; // already set
    if (obj.serviceUrl) {
      try {
        const hostname = new URL(obj.serviceUrl).hostname.replace(/^www\./, '');
        obj.iconUrl = `https://icon.horse/icon/${hostname}`;
        return;
      } catch {}
    }
    if (obj.serviceName || obj.name) {
      const name = (obj.serviceName || obj.name || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
      if (name) obj.iconUrl = `https://icon.horse/icon/${name}.com`;
    }
  }

  private async wizardWithWebSearch(
    userMessage: string,
    systemPrompt: string,
    locale: string,
  ): Promise<any | null> {
    try {
      await this.acquireSlot();
      const response = await (this.openai as any).responses.create({
        model: 'gpt-4o-mini',
        tools: [{ type: 'web_search_preview' }],
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Search the web for current pricing of: "${userMessage}". Find the official pricing page and return subscription plans in the required JSON format.` },
        ],
        temperature: 0.2,
      });

      const content = response.output_text || response.output?.[response.output?.length - 1]?.content?.[0]?.text || '';
      if (!content) return null;

      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.done !== undefined) return parsed;
      }
      return null;
    } catch (e) {
      console.warn(`Wizard web search failed: ${e}`);
      return null;
    }
  }

  async matchService(name: string) {
    const result = await this.chat([
      {
        role: 'system',
        content: 'You are a subscription service matcher. Given a fuzzy name, return JSON with: matches (array of { id (uuid), name (official name), confidence (0-1), iconUrl (clearbit logo URL), website (official URL) }). Return top 3 matches. If no match, return empty array.',
      },
      { role: 'user', content: `Match subscription service: "${name}"` },
    ]);
    return { matches: Array.isArray(result.matches) ? result.matches : [] };
  }

  async getSubscriptionInsights(_userId: string) {
    return {
      estimatedMonthlySavings: 0,
      duplicates: [],
      insights: [],
    };
  }

  async suggestCancelUrl(serviceName: string) {
    return this.chat([
      {
        role: 'system',
        content:
          'You are a subscription cancellation assistant. Return JSON with: cancelUrl (direct URL to cancel), steps (array of string instructions to cancel the subscription).',
      },
      {
        role: 'user',
        content: `How do I cancel my ${serviceName} subscription? Provide the cancelUrl and step-by-step instructions.`,
      },
    ]);
  }
}
