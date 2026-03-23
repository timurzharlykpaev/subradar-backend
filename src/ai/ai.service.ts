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
    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
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
      });
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
      });
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
      });
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
      });
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
      });
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
  async wizard(message: string, context: Record<string, any> = {}, locale = 'en') {
    const contextStr = Object.keys(context).length
      ? `\nAccumulated context so far: ${JSON.stringify(context)}`
      : '';

    const result = await this.chat([
      {
        role: 'system',
        content: `You are a smart subscription assistant. Your job is to extract subscription details from the user's message and your own knowledge of well-known services.

Rules:
1. Use your knowledge to fill in typical price, billing period, website URL, cancel URL and category for known services (Netflix, Spotify, iCloud, YouTube Premium, ChatGPT Plus, Amazon Prime, Disney+, Apple TV+, Adobe CC, GitHub Copilot etc.)
2. If the user mentions a known service, auto-fill its typical data and return done:true immediately.
3. Ask clarifying questions ONLY if: (a) you can't identify the service, OR (b) user explicitly provided a price that differs from typical.
4. Ask ONE question at a time. Keep questions short and friendly (locale: ${locale}).
5. Return ONLY valid JSON, no markdown.

Response schema:
- If enough info: { "done": true, "subscription": { "name": string, "amount": number, "currency": "USD", "billingPeriod": "MONTHLY"|"YEARLY"|"WEEKLY"|"QUARTERLY", "category": string, "serviceUrl": string|null, "cancelUrl": string|null, "iconUrl": string|null } }
- If need more info: { "done": false, "question": string, "field": "name"|"amount"|"period"|"clarify", "partialContext": { ...updated fields so far } }

iconUrl format: https://logo.clearbit.com/{domain} for known services.${contextStr}`,
      },
      { role: 'user', content: message.slice(0, 1000) },
    ]);

    if (typeof result === 'object' && result !== null) return result;
    try { return JSON.parse(String(result)); } catch { return { done: false, question: 'Что за сервис?', field: 'name', partialContext: {} }; }
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
