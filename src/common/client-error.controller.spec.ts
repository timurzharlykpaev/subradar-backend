import { Test, TestingModule } from '@nestjs/testing';
import { ClientErrorController } from './client-error.controller';
import { TelegramAlertService } from './telegram-alert.service';

const mockTelegramAlertService = { send: jest.fn().mockResolvedValue(undefined) };

describe('ClientErrorController', () => {
  let controller: ClientErrorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientErrorController],
      providers: [
        { provide: TelegramAlertService, useValue: mockTelegramAlertService },
      ],
    }).compile();

    controller = module.get<ClientErrorController>(ClientErrorController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('report → handles web error', async () => {
    const dto = { message: 'Uncaught error', url: 'https://app.subradar.ai/subs', platform: 'web' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles iOS mobile error', async () => {
    const dto = { message: 'Native crash', platform: 'ios v1.2.0', stack: 'at line 42' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles android error', async () => {
    const dto = { message: 'Network error', platform: 'android', version: '1.0.0' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles mobile platform keyword', async () => {
    const dto = { message: 'Error', platform: 'mobile-ios', context: 'subscription-list' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles unknown platform', async () => {
    const dto = { message: 'Error', platform: 'unknown' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles error without platform', async () => {
    const dto = { message: 'Error without platform' } as any;
    const result = await controller.report(dto);
    expect(result).toBeUndefined();
  });
});
