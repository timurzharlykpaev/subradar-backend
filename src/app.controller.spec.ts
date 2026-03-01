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

  it('should return health status', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
  });
});
