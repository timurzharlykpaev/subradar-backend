import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { BillingService } from '../billing/billing.service';

describe('AiController', () => {
  let controller: AiController;

  const mockAiService = {
    lookupService: jest.fn().mockResolvedValue({ name: 'Netflix', price: 15 }),
    parseScreenshot: jest.fn().mockResolvedValue({ name: 'Spotify' }),
    voiceToSubscription: jest.fn().mockResolvedValue({ name: 'Hulu' }),
    suggestCancelUrl: jest.fn().mockResolvedValue({ url: 'https://cancel.me' }),
    parseBulkSubscriptions: jest.fn().mockResolvedValue([{ name: 'Netflix' }]),
    voiceToBulkSubscriptions: jest.fn().mockResolvedValue({ text: 'hello', subscriptions: [] }),
  };

  const mockBillingService = {
    consumeAiRequest: jest.fn().mockResolvedValue(undefined),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiService, useValue: mockAiService },
        { provide: BillingService, useValue: mockBillingService },
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
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Netflix', undefined, undefined);
    expect(result).toHaveProperty('name');
  });

  it('lookupServiceAlias → consumes AI request and returns result', async () => {
    const dto = { query: 'Spotify', locale: 'en', country: 'US' } as any;
    await controller.lookupServiceAlias(req, dto);
    expect(mockBillingService.consumeAiRequest).toHaveBeenCalledWith('user-1');
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Spotify', 'en', 'US');
  });

  it('search → delegates to lookupService', async () => {
    const dto = { query: 'Hulu' } as any;
    await controller.search(req, dto);
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Hulu', undefined, undefined);
  });

  it('parseScreenshot with imageBase64 in body', async () => {
    const dto = { imageBase64: 'base64data' } as any;
    const result = await controller.parseScreenshot(req, dto, undefined);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith('base64data');
    expect(result).toHaveProperty('name');
  });

  it('parseScreenshot with file upload', async () => {
    const dto = {} as any;
    const file = { buffer: Buffer.from('filedata') } as any;
    await controller.parseScreenshot(req, dto, file);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith('ZmlsZWRhdGE=');
  });

  it('parseScreenshot falls back to empty string', async () => {
    await controller.parseScreenshot(req, {} as any, undefined);
    expect(mockAiService.parseScreenshot).toHaveBeenCalledWith('');
  });

  it('voice → calls voiceToSubscription', async () => {
    const dto = { audioBase64: 'audio', locale: 'en' } as any;
    const result = await controller.voice(req, dto);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('audio', 'en');
    expect(result).toHaveProperty('name');
  });

  it('voice → uses empty string when no audioBase64', async () => {
    await controller.voice(req, {} as any);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('', undefined);
  });

  it('voiceToSubscriptionAlias with file upload', async () => {
    const file = { buffer: Buffer.from('voicedata') } as any;
    await controller.voiceToSubscriptionAlias(req, {} as any, file);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('dm9pY2VkYXRh', undefined);
  });

  it('voiceToSubscriptionAlias with body audio', async () => {
    const dto = { audioBase64: 'bodyaudio', locale: 'ru' } as any;
    await controller.voiceToSubscriptionAlias(req, dto, undefined);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('bodyaudio', 'ru');
  });

  it('parseAudio → delegates to voiceToSubscription', async () => {
    const dto = { audioBase64: 'aud' } as any;
    await controller.parseAudio(req, dto, undefined);
    expect(mockAiService.voiceToSubscription).toHaveBeenCalledWith('aud', undefined);
  });

  it('parseText → calls lookupService with text', async () => {
    const dto = { text: 'Netflix monthly', locale: 'en' } as any;
    await controller.parseText(req, dto);
    expect(mockAiService.lookupService).toHaveBeenCalledWith('Netflix monthly');
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

  it('parseBulk → wraps non-array in array', async () => {
    mockAiService.parseBulkSubscriptions.mockResolvedValueOnce({ name: 'Netflix' });
    const dto = { text: 'Netflix', locale: 'ru' } as any;
    const result = await controller.parseBulk(req, dto);
    expect(result.subscriptions).toHaveLength(1);
  });

  it('parseBulk → returns empty array for null result', async () => {
    mockAiService.parseBulkSubscriptions.mockResolvedValueOnce(null);
    const dto = { text: '' } as any;
    const result = await controller.parseBulk(req, dto);
    expect(result.subscriptions).toHaveLength(0);
  });

  it('voiceBulk → calls voiceToBulkSubscriptions', async () => {
    const dto = { audioBase64: 'bulk', locale: 'ru' } as any;
    const result = await controller.voiceBulk(req, dto, undefined);
    expect(mockAiService.voiceToBulkSubscriptions).toHaveBeenCalledWith('bulk', 'ru');
    expect(result).toHaveProperty('subscriptions');
  });

  it('voiceBulk with file upload', async () => {
    const file = { buffer: Buffer.from('bulkvoice') } as any;
    await controller.voiceBulk(req, { locale: 'ru' } as any, file);
    expect(mockAiService.voiceToBulkSubscriptions).toHaveBeenCalledWith('YnVsa3ZvaWNl', 'ru');
  });
});
