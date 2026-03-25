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
        result.iconUrl = `https://logo.clearbit.com/${hostname}`;
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
        content: `You are a bulk subscription extractor. The user describes multiple subscriptions in free text or voice. Extract ALL subscriptions mentioned and return a JSON array: [ { name, amount (number), currency, billingPeriod (MONTHLY/YEARLY/WEEKLY/QUARTERLY), category (STREAMING/AI_SERVICES/INFRASTRUCTURE/PRODUCTIVITY/MUSIC/GAMING/NEWS/HEALTH/OTHER) } ]. If only one subscription is mentioned, still return an array with one item. Never return an object — always an array. Locale: ${locale}.`,
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
- YouTube Premium: $13.99/mo (individual), $22.99/mo (family) | youtube.com | STREAMING
- Netflix: Standard $15.49/mo, Premium $22.99/mo, Standard+Ads $7.99/mo | netflix.com | STREAMING  
- Spotify: Premium $11.99/mo, Duo $16.99/mo, Family $19.99/mo | spotify.com | MUSIC
- Apple Music: Individual $10.99/mo, Family $16.99/mo | music.apple.com | MUSIC
- Apple iCloud+: 50GB $0.99/mo, 200GB $2.99/mo, 2TB $9.99/mo | icloud.com | INFRASTRUCTURE
- ChatGPT Plus: $20/mo | chat.openai.com | AI_SERVICES
- ChatGPT Pro: $200/mo | chat.openai.com | AI_SERVICES
- LinkedIn Premium Career: $39.99/mo, Business: $59.99/mo, Sales Navigator: $99.99/mo | linkedin.com | PRODUCTIVITY
- Adobe Creative Cloud: All Apps $59.99/mo, Photography $19.99/mo, Single App $35.99/mo | adobe.com | PRODUCTIVITY
- Microsoft 365: Personal $6.99/mo, Family $9.99/mo | microsoft.com | PRODUCTIVITY
- Amazon Prime: $14.99/mo or $139/yr | amazon.com | STREAMING
- Disney+: Basic $7.99/mo, Premium $13.99/mo | disneyplus.com | STREAMING
- Hulu: With Ads $7.99/mo, No Ads $17.99/mo | hulu.com | STREAMING
- Apple TV+: $9.99/mo | tv.apple.com | STREAMING
- GitHub Copilot: Individual $10/mo, Business $19/mo | github.com | INFRASTRUCTURE
- Notion: Plus $10/mo, Business $15/mo | notion.so | PRODUCTIVITY
- Figma: Professional $12/mo, Organization $45/mo | figma.com | PRODUCTIVITY
- DigitalOcean: variable | digitalocean.com | INFRASTRUCTURE
- Dropbox: Plus $11.99/mo, Essentials $22/mo | dropbox.com | INFRASTRUCTURE

CRITICAL RULES (follow strictly):
1. Use EXACT prices from the database above. NEVER guess or ask about prices for known services.
2. For services with MULTIPLE tiers (LinkedIn, Netflix, Spotify, Adobe, Apple iCloud, Microsoft 365, ChatGPT) → ALWAYS return "plans" array immediately. NEVER ask "which plan?".
3. For single-plan services → return single "subscription".
4. ONLY ask a question if the service is completely unknown AND not in the database above.
5. NEVER ask about price or plan for services listed in the database — show plans instead.
6. Always include iconUrl: https://logo.clearbit.com/{domain}
7. Return ONLY valid JSON. No markdown. No explanation.

EXAMPLE — when user says "LinkedIn" or "LinkedIn Premium":
{"done":true,"plans":[{"name":"LinkedIn Premium Career","amount":39.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"LinkedIn Premium Business","amount":59.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"LinkedIn Sales Navigator","amount":99.99,"billingPeriod":"MONTHLY","currency":"USD"}],"serviceName":"LinkedIn Premium","iconUrl":"https://logo.clearbit.com/linkedin.com","serviceUrl":"https://linkedin.com/premium","cancelUrl":"https://linkedin.com/premium/cancel","category":"PRODUCTIVITY"}

EXAMPLE — when user says "Netflix":
{"done":true,"plans":[{"name":"Netflix Standard with Ads","amount":7.99,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"Netflix Standard","amount":15.49,"billingPeriod":"MONTHLY","currency":"USD"},{"name":"Netflix Premium","amount":22.99,"billingPeriod":"MONTHLY","currency":"USD"}],"serviceName":"Netflix","iconUrl":"https://logo.clearbit.com/netflix.com","serviceUrl":"https://netflix.com","cancelUrl":"https://netflix.com/cancelplan","category":"STREAMING"}

Valid categories: STREAMING, AI_SERVICES, INFRASTRUCTURE, PRODUCTIVITY, MUSIC, GAMING, NEWS, HEALTH, OTHER

Response schemas:
A) Single plan: { "done": true, "subscription": { "name": string, "amount": number, "currency": "USD", "billingPeriod": "MONTHLY"|"YEARLY", "category": string, "serviceUrl": string, "cancelUrl": string|null, "iconUrl": string } }
B) Multiple plans: { "done": true, "plans": [{ "name": string, "amount": number, "billingPeriod": "MONTHLY"|"YEARLY", "currency": "USD" }], "serviceName": string, "iconUrl": string, "serviceUrl": string, "cancelUrl": string|null, "category": string }
C) Need info: { "done": false, "question": string, "field": "name"|"amount"|"period"|"clarify", "partialContext": {} }${currencyNote}${contextStr}`,
    };

    // Build messages: system + history + current user message
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      systemMsg,
      ...history.slice(-8).map((h) => ({ role: h.role, content: h.content.slice(0, 500) })),
      { role: 'user', content: message.slice(0, 1000) },
    ];

    const result = await this.chat(messages);

    if (typeof result === 'object' && result !== null) return result;
    try { return JSON.parse(String(result)); } catch { return { done: false, question: 'What service is this?', field: 'name', partialContext: {} }; }
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
