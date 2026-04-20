import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { BillingService } from '../billing/billing.service';
import { MarketDataService } from '../analysis/market-data.service';

describe('AiController', () => {
  let controller: AiController;

  const mockAiService = {
    lookupService: jest.fn().mockResolvedValue({ name: 'Netflix', price: 15 }),
    parseScreenshot: jest.fn().mockResolvedValue({ name: 'Spotify' }),
    voiceToSubscription: jest.fn().mockResolvedValue({ name: 'Hulu' }),
    transcribeAudio: jest.fn().mockResolvedValue({ text: 'transcribed' }),
    suggestCancelUrl: jest.fn().mockResolvedValue({ url: 'https://cancel.me' }),
    parseBulkSubscriptions: jest.fn().mockResolvedValue([{ name: 'Netflix' }]),
    voiceToBulkSubscriptions: jest.fn().mockResolvedValue({ text: 'hello', subscriptions: [] }),
  };

  // Valid file signatures for mime validation
  // PNG: 89 50 4E 47
  const validImageBuffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('filedata')]);
  // ID3 (MP3): 49 44 33
  const validAudioBuffer = Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.from('voicedata')]);
  const validAudioBuffer2 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.from('bulkvoice')]);

  const mockBillingService = {
    consumeAiRequest: jest.fn().mockResolvedValue(undefined),
  };

  const mockMarketDataService = {
    normalizeServiceName: jest.fn((s: string) => s),
    getMarketData: jest.fn().mockResolvedValue(null),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiService, useValue: mockAiService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: MarketDataService, useValue: mockMarketDataService },
      ],
    }).compile();

    controller = module.get<AiController>(AiController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('lookup → consumes AI request and returns result', async () => {
    const dto = { query: 'Netflix' } as any;
    const result = await controller.lookup(req, dto);
    expect(mockBillingService.consumeAiRequest).toHaveBeenCalledWith('user-1');
    // Controller resolves locale/currency/country from req.user with defaults.
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Netflix', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
    expect(result).toHaveProperty('name');
  });

  it('lookupServiceAlias → consumes AI request and returns result', async () => {
    const dto = { query: 'Spotify', locale: 'en', country: 'US' } as any;
    await controller.lookupServiceAlias(req, dto);
    expect(mockBillingService.consumeAiRequest).toHaveBeenCalledWith('user-1');
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Spotify', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
  });

  it('search → delegates to lookupService', async () => {
    const dto = { query: 'Hulu' } as any;
    await controller.search(req, dto);
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Hulu', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
  });

  it('parseScreenshot with imageBase64 in body', async () => {
    const dto = { imageBase64: 'base64data' } as any;
    const result = await controller.parseScreenshot(req, dto, undefined);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith('base64data', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
    expect(result).toHaveProperty('name');
  });

  it('parseScreenshot with file upload', async () => {
    const dto = {} as any;
    const file = { buffer: validImageBuffer } as any;
    await controller.parseScreenshot(req, dto, file);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith(
      validImageBuffer.toString('base64'),
      { locale: 'en', currency: 'USD', country: 'US' },
    );
  });

  it('parseScreenshot falls back to empty string', async () => {
    await controller.parseScreenshot(req, {} as any, undefined);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith('', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
  });

  it('voice → calls voiceToSubscription', async () => {
    const dto = { audioBase64: 'audio', locale: 'en' } as any;
    const result = await controller.voice(req, dto);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('audio', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
    expect(result).toHaveProperty('name');
  });

  it('voice → uses empty string when no audioBase64', async () => {
    await controller.voice(req, {} as any);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
  });

  it('voiceToSubscriptionAlias with file upload', async () => {
    const file = { buffer: validAudioBuffer } as any;
    await controller.voiceToSubscriptionAlias(req, {} as any, file);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith(
      validAudioBuffer.toString('base64'),
      { locale: 'en', currency: 'USD', country: 'US' },
    );
  });

  it('voiceToSubscriptionAlias with body audio', async () => {
    const dto = { audioBase64: 'bodyaudio', locale: 'ru' } as any;
    await controller.voiceToSubscriptionAlias(req, dto, undefined);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('bodyaudio', {
      locale: 'ru',
      currency: 'USD',
      country: 'US',
    });
  });

  it('parseAudio → delegates to transcribeAudio with resolved locale', async () => {
    const dto = { audioBase64: 'aud' } as any;
    await controller.parseAudio(req, dto, undefined);
    expect(mockAiService.transcribeAudio).toHaveBeenCalledWith('aud', 'en');
  });

  it('parseText → calls lookupService with text and resolved context', async () => {
    const dto = { text: 'Netflix monthly', locale: 'en' } as any;
    await controller.parseText(req, dto);
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Netflix monthly', {
      locale: 'en',
      currency: 'USD',
      country: 'US',
    });
  });

  it('suggestCancel → calls suggestCancelUrl', async () => {
    const dto = { serviceName: 'Netflix' } as any;
    const result = await controller.suggestCancel(req, dto);
    expect(mockAiService.suggestCancelUrl).toHaveBeenCalledWith('Netflix');
    expect(result).toHaveProperty('url');
  });

  it('parseBulk → returns subscriptions array', async () => {
    const dto = { text: 'Netflix $15, Spotify $10', locale: 'en' } as any;
    const result = await controller.parseBulk(req, dto);
    expect(mockBillingService.consumeAiRequest).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('subscriptions');
    expect(Array.isArray(result.subscriptions)).toBe(true);
  });

  it('parseBulk → passes through service result', async () => {
    mockAiService.parseBulkSubscriptions.mockResolvedValueOnce({ name: 'Netflix' });
    const dto = { text: 'Netflix', locale: 'ru' } as any;
    const result = await controller.parseBulk(req, dto);
    expect(result.subscriptions).toEqual({ name: 'Netflix' });
  });

  it('parseBulk → passes through null result', async () => {
    mockAiService.parseBulkSubscriptions.mockResolvedValueOnce(null);
    const dto = { text: '' } as any;
    const result = await controller.parseBulk(req, dto);
    expect(result.subscriptions).toBeNull();
  });

  it('voiceBulk → calls voiceToBulkSubscriptions with locale + currency + country', async () => {
    const dto = { audioBase64: 'bulk', locale: 'ru' } as any;
    const result = await controller.voiceBulk(req, dto, undefined);
    expect(mockAiService.voiceToBulkSubscriptions).toHaveBeenCalledWith('bulk', 'ru', 'USD', 'US');
    expect(result).toHaveProperty('subscriptions');
  });

  it('voiceBulk with file upload forwards resolved context', async () => {
    const file = { buffer: validAudioBuffer2 } as any;
    await controller.voiceBulk(req, { locale: 'ru' } as any, file);
    expect(mockAiService.voiceToBulkSubscriptions).toHaveBeenCalledWith(
      validAudioBuffer2.toString('base64'),
      'ru',
      'USD',
      'US',
    );
  });
});
