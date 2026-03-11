import { Test, TestingModule } from '@nestjs/testing';
import { ClientErrorController } from './client-error.controller';

describe('ClientErrorController', () => {
  let controller: ClientErrorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientErrorController],
    }).compile();

    controller = module.get<ClientErrorController>(ClientErrorController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('report → handles web error', () => {
    const dto = { message: 'Uncaught error', url: 'https://app.subradar.ai/subs', platform: 'web' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles iOS mobile error', () => {
    const dto = { message: 'Native crash', platform: 'ios v1.2.0', stack: 'at line 42' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles android error', () => {
    const dto = { message: 'Network error', platform: 'android', version: '1.0.0' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles mobile platform keyword', () => {
    const dto = { message: 'Error', platform: 'mobile-ios', context: 'subscription-list' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles unknown platform', () => {
    const dto = { message: 'Error', platform: 'unknown' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });

  it('report → handles error without platform', () => {
    const dto = { message: 'Error without platform' } as any;
    const result = controller.report(dto);
    expect(result).toBeUndefined();
  });
});
