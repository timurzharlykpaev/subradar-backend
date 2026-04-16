import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    controller = app.get<AppController>(AppController);
  });

  it('should return ok status from ping', () => {
    const result = controller.ping();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });
});
