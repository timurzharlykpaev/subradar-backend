import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { EmailThrottlerGuard } from './guards/email-throttler.guard';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    login: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    googleLogin: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    googleTokenLogin: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    appleLogin: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    sendOtp: jest.fn().mockResolvedValue({ sent: true }),
    verifyOtp: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    sendMagicLink: jest.fn().mockResolvedValue({ sent: true }),
    verifyMagicLink: jest
      .fn()
      .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    refresh: jest.fn().mockResolvedValue({ accessToken: 'at' }),
    logout: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({ id: '1', email: 'test@test.com' }),
    update: jest.fn().mockResolvedValue({ id: '1', name: 'Updated' }),
  };

  // Mock express-like request with realistic IP/UA — controller now passes
  // these through to the service for audit-log enrichment.
  const mkReq = (extra: Record<string, unknown> = {}) =>
    ({
      ip: '198.51.100.42',
      headers: {
        'user-agent': 'jest-test-runner/1.0',
        'x-forwarded-for': '198.51.100.42',
      },
      ...extra,
    }) as any;

  // Matcher for the AuthContext shape that controller injects from req.
  const ctxMatcher = expect.objectContaining({
    ipAddress: expect.any(String),
    userAgent: expect.any(String),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(EmailThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('register → calls authService.register with ctx', async () => {
    const dto = { email: 'test@test.com', password: 'pass' } as any;
    const result = await controller.register(mkReq(), dto);
    expect(mockAuthService.register).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('accessToken');
  });

  it('login → calls authService.login with ctx', async () => {
    const dto = { email: 'test@test.com', password: 'pass' } as any;
    const result = await controller.login(mkReq(), dto);
    expect(mockAuthService.login).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('accessToken');
  });

  it('googleTokenLogin → calls authService.googleTokenLogin with ctx', async () => {
    const result = await controller.googleTokenLogin(mkReq(), {
      idToken: 'id-token',
    });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith(
      'id-token',
      ctxMatcher,
    );
    expect(result).toHaveProperty('accessToken');
  });

  it('googleTokenLogin uses accessToken when idToken absent', async () => {
    await controller.googleTokenLogin(mkReq(), { accessToken: 'acc-token' });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith(
      'acc-token',
      ctxMatcher,
    );
  });

  it('googleTokenLogin uses empty string when both absent', async () => {
    await controller.googleTokenLogin(mkReq(), {});
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith(
      '',
      ctxMatcher,
    );
  });

  it('appleLogin → calls authService.appleLogin with ctx', async () => {
    const dto = { identityToken: 'tok' } as any;
    const result = await controller.appleLogin(mkReq(), dto);
    expect(mockAuthService.appleLogin).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('accessToken');
  });

  it('sendOtp → calls authService.sendOtp with ctx', async () => {
    const dto = { phone: '+1234567890' } as any;
    const result = await controller.sendOtp(mkReq(), dto);
    expect(mockAuthService.sendOtp).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('sent');
  });

  it('verifyOtp → calls authService.verifyOtp with ctx', async () => {
    const dto = { phone: '+1234567890', code: '1234' } as any;
    const result = await controller.verifyOtp(mkReq(), dto);
    expect(mockAuthService.verifyOtp).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('accessToken');
  });

  it('sendMagicLink → calls authService.sendMagicLink with ctx', async () => {
    const dto = { email: 'test@test.com' } as any;
    const result = await controller.sendMagicLink(mkReq(), dto);
    expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(dto, ctxMatcher);
    expect(result).toHaveProperty('sent');
  });

  it('verifyMagicLink (GET) → calls authService.verifyMagicLink with ctx', async () => {
    const result = await controller.verifyMagicLink(mkReq(), 'magic-token');
    expect(mockAuthService.verifyMagicLink).toHaveBeenCalledWith(
      'magic-token',
      ctxMatcher,
    );
    expect(result).toHaveProperty('accessToken');
  });

  it('verifyMagicLinkPost → calls authService.verifyMagicLink', async () => {
    const result = await controller.verifyMagicLinkPost({
      token: 'magic-token',
    });
    expect(mockAuthService.verifyMagicLink).toHaveBeenCalledWith('magic-token');
    expect(result).toHaveProperty('accessToken');
  });

  it('refresh → calls authService.refresh with ctx', async () => {
    const result = await controller.refresh(mkReq(), {
      refreshToken: 'rt',
    } as any);
    expect(mockAuthService.refresh).toHaveBeenCalledWith('rt', ctxMatcher);
    expect(result).toHaveProperty('accessToken');
  });

  it('logout → calls authService.logout with user id and ctx', async () => {
    const req = mkReq({ user: { id: 'user-1' } });
    const result = await controller.logout(req);
    expect(mockAuthService.logout).toHaveBeenCalledWith('user-1', ctxMatcher);
    expect(result).toHaveProperty('success');
  });

  it('me → calls usersService.findById', async () => {
    const req = mkReq({ user: { id: 'user-1' } });
    const result = await controller.me(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('email');
  });

  it('getProfile → calls usersService.findById', async () => {
    const req = mkReq({ user: { id: 'user-1' } });
    const result = await controller.getProfile(req);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('email');
  });

  it('updateProfile → calls usersService.update', async () => {
    const req = mkReq({ user: { id: 'user-1' } });
    const result = await controller.updateProfile(req, { name: 'New Name' });
    expect(mockUsersService.update).toHaveBeenCalledWith('user-1', {
      name: 'New Name',
    });
    expect(result).toHaveProperty('id');
  });

  it('googleMobileLogin → calls authService.googleTokenLogin', async () => {
    const result = await controller.googleMobileLogin({
      idToken: 'mobile-token',
    });
    expect(mockAuthService.googleTokenLogin).toHaveBeenCalledWith(
      'mobile-token',
    );
    expect(result).toHaveProperty('accessToken');
  });
});
