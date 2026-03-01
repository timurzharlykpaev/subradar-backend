import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly cfg: ConfigService) {
    this.openai = new OpenAI({ apiKey: cfg.get('OPENAI_API_KEY') });
    this.model = cfg.get('OPENAI_MODEL', 'gpt-4o');
  }

  private async chat(
    messages: OpenAI.ChatCompletionMessageParam[],
    jsonMode = true,
  ) {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
      temperature: 0.2,
    });
    const content = response.choices[0].message.content || '{}';
    return jsonMode ? JSON.parse(content) : content;
  }

  async lookupService(query: string, locale = 'en', country = 'US') {
    return this.chat([
      {
        role: 'system',
        content: `You are a subscription service lookup assistant. Return JSON with fields: name, iconUrl, serviceUrl, cancelUrl, category (one of STREAMING/AI_SERVICES/INFRASTRUCTURE/PRODUCTIVITY/MUSIC/GAMING/NEWS/HEALTH/OTHER), plans (array of {name, price, currency, period}). Locale: ${locale}, Country: ${country}.`,
      },
      {
        role: 'user',
        content: `Look up subscription service: "${query}"`,
      },
    ]);
  }

  async parseScreenshot(imageBase64: string) {
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
  }

  async voiceToSubscription(audioBase64: string, locale = 'en') {
    // First transcribe audio
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const audioFile = new File([audioBuffer], 'audio.webm', {
      type: 'audio/webm',
    });

    const transcription = await this.openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: locale.split('-')[0],
    });

    const text = transcription.text;

    // Then parse subscription details from transcript
    return this.chat([
      {
        role: 'system',
        content:
          'You are a subscription data extractor. From the voice transcript, extract subscription fields and return JSON with: name, amount, currency, billingPeriod, category, notes, startDate.',
      },
      { role: 'user', content: `Voice transcript: "${text}"` },
    ]);
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
