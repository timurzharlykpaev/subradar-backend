import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockService = { findById: jest.fn(), update: jest.fn(), updatePreferences: jest.fn(), updateFcmToken: jest.fn() };
const mockReq = { user: { id: 'user-1' } };

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });
  it('getMe calls service.findById', async () => {
    mockService.findById.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });
    const result = await controller.getMe(mockReq as any);
    expect(mockService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('id', 'user-1');
  });
});
