import { Test, TestingModule } from '@nestjs/testing';
import { EmailImportController } from './email-import.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AiService } from '../ai/ai.service';
import { UsersService } from '../users/users.service';
import { SubscriptionStatus } from './entities/subscription.entity';

describe('EmailImportController', () => {
  let controller: EmailImportController;

  const mockSubsService = {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ name: 'Netflix', amount: 15 }),
  };

  const mockAiService = {
    parseEmailText: jest.fn().mockResolvedValue({ name: 'Netflix', amount: 15, currency: 'USD', billingPeriod: 'MONTHLY', category: 'ENTERTAINMENT' }),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({ id: 'user-abc', email: 'user@test.com' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailImportController],
      providers: [
        { provide: SubscriptionsService, useValue: mockSubsService },
        { provide: AiService, useValue: mockAiService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<EmailImportController>(EmailImportController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('returns no_user_id when To header lacks userId', async () => {
    const payload = { From: 'sender@test.com', To: 'other@subradar.ai', Subject: 'Your receipt', TextBody: 'payment receipt' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: false, reason: 'no_user_id' });
  });

  it('returns user_not_found when user does not exist', async () => {
    mockUsersService.findById.mockRejectedValueOnce(new Error('Not found'));
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Receipt', TextBody: 'billing payment' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('returns not_subscription_email when content has no keywords', async () => {
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Hello World', TextBody: 'Just a friendly message' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: false, reason: 'not_subscription_email' });
  });

  it('returns ai_parse_failed when AI throws', async () => {
    mockAiService.parseEmailText.mockRejectedValueOnce(new Error('AI down'));
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Your subscription receipt', TextBody: 'Your Netflix subscription billing receipt payment' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: false, reason: 'ai_parse_failed' });
  });

  it('returns not_enough_data when AI returns no name', async () => {
    mockAiService.parseEmailText.mockResolvedValueOnce({ amount: 15 });
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Invoice', TextBody: 'your monthly subscription billing payment receipt' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: false, reason: 'not_enough_data' });
  });

  it('returns duplicate when subscription already exists', async () => {
    mockSubsService.findAll.mockResolvedValueOnce([{ name: 'Netflix', status: SubscriptionStatus.ACTIVE }]);
    mockAiService.parseEmailText.mockResolvedValueOnce({ name: 'Netflix', amount: 15 });
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Netflix receipt', TextBody: 'Your Netflix subscription renewal billing payment receipt' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toEqual({ ok: true, reason: 'duplicate', name: 'Netflix' });
  });

  it('creates subscription when all checks pass', async () => {
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Spotify receipt', TextBody: 'Your Spotify subscription monthly billing payment receipt' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(mockSubsService.create).toHaveBeenCalledWith('user-abc', expect.objectContaining({ name: 'Netflix', amount: 15 }));
    expect(result).toEqual({ ok: true, imported: true, name: 'Netflix', amount: 15 });
  });

  it('parses HtmlBody when TextBody is absent', async () => {
    const payload = { From: 'sender@test.com', To: 'import+user-abc@subradar.ai', Subject: 'Invoice', HtmlBody: '<p>Your subscription billing receipt monthly payment</p>' };
    const result = await controller.handleInbound(payload as any, 'token');
    expect(result).toHaveProperty('ok');
  });

  it('getImportAddress returns email with userId', () => {
    const result = controller.getImportAddress({ userId: 'user-123' });
    expect(result.email).toBe('import+user-123@subradar.ai');
    expect(result).toHaveProperty('instructions');
  });
});
