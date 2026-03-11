import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    login: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    googleLogin: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    googleTokenLogin: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    appleLogin: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    sendOtp: jest.fn().mockResolvedValue({ sent: true }),
    verifyOtp: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    sendMagicLink: jest.fn().mockResolvedValue({ sent: true }),
    verifyMagicLink: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    refresh: jest.fn().mockResolvedValue({ accessToken: 'at' }),
    logout: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({ id: '1', email: 'test@test.com' }),
    update: jest.fn().mockResolvedValue({ id: '1', name: 'Updated' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('register → calls authService.register', async () => {
    const dto = { email: 'test@test.com', password: 'pass' } as any;
    const result = await controller.register(dto);
    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('accessToken');
  });

  it('login → calls authService.login', async () => {
    const dto = { email: 'test@test.com', password: 'pass' } as any;
    const result = await controller.login(dto);
    expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('accessToken');
  });

  it('googleTokenLogin → calls authService.googleTokenLogin', async () => {
    const result = await controller.googleTokenLogin({ idToken: 'id-token' });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith('id-token');
    expect(result).toHaveProperty('accessToken');
  });

  it('googleTokenLogin uses accessToken when idToken absent', async () => {
    await controller.googleTokenLogin({ accessToken: 'acc-token' });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith('acc-token');
  });

  it('googleTokenLogin uses empty string when both absent', async () => {
    await controller.googleTokenLogin({});
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith('');
  });

  it('appleLogin → calls authService.appleLogin', async () => {
    const dto = { identityToken: 'tok' } as any;
    const result = await controller.appleLogin(dto);
    expect(mockAuthService.appleLogin).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('accessToken');
  });

  it('sendOtp → calls authService.sendOtp', async () => {
    const dto = { phone: '+1234567890' } as any;
    const result = await controller.sendOtp(dto);
    expect(mockAuthService.sendOtp).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('sent');
  });

  it('verifyOtp → calls authService.verifyOtp', async () => {
    const dto = { phone: '+1234567890', code: '1234' } as any;
    const result = await controller.verifyOtp(dto);
    expect(mockAuthService.verifyOtp).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('accessToken');
  });

  it('sendMagicLink → calls authService.sendMagicLink', async () => {
    const dto = { email: 'test@test.com' } as any;
    const result = await controller.sendMagicLink(dto);
    expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(dto);
    expect(result).toHaveProperty('sent');
  });

  it('verifyMagicLink (GET) → calls authService.verifyMagicLink', async () => {
    const result = await controller.verifyMagicLink('magic-token');
    expect(mockAuthService.verifyMagicLink).toHaveBeenCalledWith('magic-token');
    expect(result).toHaveProperty('accessToken');
  });

  it('verifyMagicLinkPost → calls authService.verifyMagicLink', async () => {
    const result = await controller.verifyMagicLinkPost({ token: 'magic-token' });
    expect(mockAuthService.verifyMagicLink).toHaveBeenCalledWith('magic-token');
    expect(result).toHaveProperty('accessToken');
  });

  it('refresh → calls authService.refresh', async () => {
    const result = await controller.refresh({ refreshToken: 'rt' } as any);
    expect(mockAuthService.refresh).toHaveBeenCalledWith('rt');
    expect(result).toHaveProperty('accessToken');
  });

  it('logout → calls authService.logout with user id', async () => {
    const req = { user: { id: 'user-1' } } as any;
    const result = await controller.logout(req);
    expect(mockAuthService.logout).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('success');
  });

  it('me → calls usersService.findById', async () => {
    const req = { user: { id: 'user-1' } } as any;
    const result = await controller.me(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('email');
  });

  it('getProfile → calls usersService.findById', async () => {
    const req = { user: { id: 'user-1' } } as any;
    const result = await controller.getProfile(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('email');
  });

  it('updateProfile → calls usersService.update', async () => {
    const req = { user: { id: 'user-1' } } as any;
    const result = await controller.updateProfile(req, { name: 'New Name' });
    expect(mockUsersService.update).toHaveBeenCalledWith('user-1', { name: 'New Name' });
    expect(result).toHaveProperty('id');
  });

  it('googleMobileLogin → calls authService.googleTokenLogin', async () => {
    const result = await controller.googleMobileLogin({ idToken: 'mobile-token' });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith('mobile-token');
    expect(result).toHaveProperty('accessToken');
  });
});
