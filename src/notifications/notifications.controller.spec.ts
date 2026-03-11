import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockService = {};

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockService }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('updateFcmToken → returns redirect message', async () => {
    const dto = { fcmToken: 'token-123' } as any;
    const result = await controller.updateFcmToken(req, dto);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('PATCH');
  });

  it('registerPushToken → returns success message', async () => {
    const dto = { token: 'push-token', platform: 'ios' as const } as any;
    const result = await controller.registerPushToken(req, dto);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('registered');
  });

  it('getSettings → returns default settings', () => {
    const result = controller.getSettings(req);
    expect(result).toHaveProperty('enabled', true);
    expect(result).toHaveProperty('daysBefore', 3);
  });

  it('updateSettings → returns updated settings with provided values', () => {
    const dto = { enabled: false, daysBefore: 7 } as any;
    const result = controller.updateSettings(req, dto);
    expect(result).toHaveProperty('enabled', false);
    expect(result).toHaveProperty('daysBefore', 7);
  });

  it('updateSettings → falls back to defaults when values not provided', () => {
    const dto = {} as any;
    const result = controller.updateSettings(req, dto);
    expect(result).toHaveProperty('enabled', true);
    expect(result).toHaveProperty('daysBefore', 3);
  });

  it('sendTest → returns queued message', async () => {
    const body = { title: 'Test', message: 'Hello' };
    const result = await controller.sendTest(req, body);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('queued');
  });
});
