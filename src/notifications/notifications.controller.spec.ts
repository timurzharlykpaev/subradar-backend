import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    sendPushNotification: jest.fn().mockResolvedValue(undefined),
  };

  const mockUsersService = {
    update: jest.fn().mockResolvedValue({ id: 'user-1', fcmToken: 'token-123' }),
    findById: jest.fn().mockResolvedValue({
      id: 'user-1',
      notificationsEnabled: true,
      reminderDaysBefore: 3,
      fcmToken: 'fcm-token',
    }),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('registerPushToken saves token via UsersService', async () => {
    const dto = { token: 'native-fcm-token', platform: 'ios' as const };
    const result = await controller.registerPushToken(req, dto);
    expect(mockUsersService.update).toHaveBeenCalledWith('user-1', { fcmToken: 'native-fcm-token' });
    expect(result.message).toContain('registered');
  });

  it('getSettings returns user notification preferences', async () => {
    const result = await controller.getSettings(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('enabled', true);
    expect(result).toHaveProperty('daysBefore', 3);
  });

  it('updateSettings persists settings via UsersService', async () => {
    const dto = { enabled: false, daysBefore: 7 };
    mockUsersService.findById.mockResolvedValueOnce({
      id: 'user-1',
      notificationsEnabled: false,
      reminderDaysBefore: 7,
      fcmToken: 'fcm-token',
    });
    const result = await controller.updateSettings(req, dto);
    expect(mockUsersService.update).toHaveBeenCalledWith('user-1', {
      notificationsEnabled: false,
      reminderDaysBefore: 7,
    });
    expect(result).toHaveProperty('enabled', false);
    expect(result).toHaveProperty('daysBefore', 7);
  });

  it('updateSettings falls back to defaults when values not provided', async () => {
    const dto = {};
    const result = await controller.updateSettings(req, dto);
    expect(result).toHaveProperty('enabled', true);
    expect(result).toHaveProperty('daysBefore', 3);
  });

  it('sendTest sends localized push when user has fcmToken', async () => {
    const result = await controller.sendTest(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(mockNotificationsService.sendPushNotification).toHaveBeenCalled();
    const args = mockNotificationsService.sendPushNotification.mock.calls[0];
    expect(args[0]).toBe('fcm-token');
    expect(typeof args[1]).toBe('string'); // title
    expect(typeof args[2]).toBe('string'); // body
    expect(args[3]).toMatchObject({ type: 'test' });
    expect(result.message).toContain('sent');
  });

  it('sendTest throws 400 when user has no fcmToken', async () => {
    mockUsersService.findById.mockResolvedValueOnce({ id: 'user-1', fcmToken: null });
    await expect(controller.sendTest(req)).rejects.toThrow();
    expect(mockNotificationsService.sendPushNotification).not.toHaveBeenCalled();
  });
});
