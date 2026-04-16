import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  }));
});

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  name: 'Test',
  password: '$2b$12$hashedpassword',
  refreshToken: 'old-refresh',
  plan: 'free',
  magicLinkToken: 'magic-token',
  magicLinkExpiry: new Date(Date.now() + 60000),
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findByEmailWithPassword: jest.fn(),
  findById: jest.fn(),
  findByMagicLinkToken: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(mockUser),
  update: jest.fn().mockResolvedValue(mockUser),
  updateRefreshToken: jest.fn().mockResolvedValue(undefined),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('test-jwt-token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-1', email: 'test@test.com' }),
  decode: jest.fn().mockReturnValue({ email: 'test@test.com', sub: 'apple-sub' }),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def?: any) => def ?? null),
};

const mockNotificationsService = {
  sendEmail: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('test-jwt-token');
    mockConfigService.get.mockImplementation((key: string, def?: any) => def ?? null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('throws ConflictException if email exists', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      await expect(service.register({ email: 'test@test.com', password: 'pass', name: 'Test' }))
        .rejects.toThrow(ConflictException);
    });

    it('registers new user and returns tokens', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      mockUsersService.create.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.register({ email: 'new@test.com', password: 'pass123', name: 'New' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException for unknown email', async () => {
      mockUsersService.findByEmailWithPassword.mockResolvedValueOnce(null);
      await expect(service.login({ email: 'x@x.com', password: 'pass' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      mockUsersService.findByEmailWithPassword.mockResolvedValueOnce({ ...mockUser, password: '$2b$12$wronghash' });
      await expect(service.login({ email: 'test@test.com', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('sendOtp', () => {
    it('sends OTP and returns message', async () => {
      mockNotificationsService.sendEmail.mockResolvedValueOnce(undefined);
      const result = await service.sendOtp({ email: 'test@test.com' });
      expect(result).toHaveProperty('message', 'OTP sent');
    });

    it('returns fixed OTP for demo accounts', async () => {
      const result = await service.sendOtp({ email: 'reviewer@subradar.ai' });
      expect(result).toHaveProperty('message', 'OTP sent');
    });
  });

  describe('googleLogin', () => {
    it('creates new user if not found', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      mockUsersService.create.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.googleLogin({ email: 'g@gmail.com', name: 'G User', avatarUrl: '', providerId: 'g-123' });
      expect(result).toHaveProperty('accessToken');
    });

    it('uses existing user if found', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.googleLogin({ email: 'test@test.com', name: 'Test', avatarUrl: '', providerId: 'g-123' });
      expect(result).toHaveProperty('user');
    });
  });

  describe('appleLogin', () => {
    it('throws UnauthorizedException if token decode fails', async () => {
      mockJwtService.decode.mockImplementationOnce(() => { throw new Error('bad token'); });
      await expect(service.appleLogin({ idToken: 'bad', name: 'Test' } as any))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException if no email in payload', async () => {
      mockJwtService.decode.mockReturnValueOnce({ sub: 'apple-sub' }); // no email
      await expect(service.appleLogin({ idToken: 'tok', name: 'Test' } as any))
        .rejects.toThrow();
    });

    it('creates new user when not exists', async () => {
      mockJwtService.decode.mockReturnValueOnce({ email: 'apple@test.com', sub: 'apple-sub' });
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      mockUsersService.create.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.appleLogin({ idToken: 'tok', name: 'Apple User' } as any);
      expect(result).toHaveProperty('accessToken');
    });

    it('uses existing user', async () => {
      mockJwtService.decode.mockReturnValueOnce({ email: 'test@test.com', sub: 'apple-sub' });
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.appleLogin({ idToken: 'tok' } as any);
      expect(result).toHaveProperty('user');
    });
  });

  describe('sendMagicLink', () => {
    it('sends magic link and returns message', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      mockUsersService.update.mockResolvedValueOnce(mockUser);
      const result = await service.sendMagicLink({ email: 'test@test.com' });
      expect(result).toHaveProperty('message', 'Magic link sent');
      expect(mockNotificationsService.sendEmail).toHaveBeenCalled();
    });

    it('creates user if not found then sends magic link', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      mockUsersService.create.mockResolvedValueOnce(mockUser);
      mockUsersService.update.mockResolvedValueOnce(mockUser);
      const result = await service.sendMagicLink({ email: 'new@test.com' });
      expect(result).toHaveProperty('message', 'Magic link sent');
      expect(mockUsersService.create).toHaveBeenCalled();
    });

    it('includes link in non-production response', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      mockUsersService.update.mockResolvedValueOnce(mockUser);
      mockConfigService.get.mockImplementation((key: string, def?: any) => {
        if (key === 'NODE_ENV') return 'development';
        return def ?? null;
      });
      const result = await service.sendMagicLink({ email: 'test@test.com' });
      expect(result).toHaveProperty('link');
    });
  });

  describe('verifyMagicLink', () => {
    it('throws UnauthorizedException for invalid token', async () => {
      // findByMagicLinkToken returns null (default) and legacy JWT path also fails
      mockJwtService.verify.mockImplementationOnce(() => { throw new Error('expired'); });
      await expect(service.verifyMagicLink('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if magic link expired', async () => {
      mockUsersService.findByMagicLinkToken.mockResolvedValueOnce({
        ...mockUser,
        magicLinkExpiry: new Date(Date.now() - 60000), // expired
      });
      await expect(service.verifyMagicLink('magic-token')).rejects.toThrow(UnauthorizedException);
    });

    it('verifies valid magic link and returns tokens', async () => {
      // New path: DB row found via sha256 hash lookup
      mockUsersService.findByMagicLinkToken.mockResolvedValueOnce(mockUser);
      mockUsersService.update.mockResolvedValueOnce(mockUser);
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.verifyMagicLink('magic-token');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException for invalid refresh token', async () => {
      mockJwtService.verify.mockImplementationOnce(() => { throw new Error('invalid'); });
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if token revoked', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      mockUsersService.findById.mockResolvedValueOnce({ ...mockUser, refreshToken: 'different-token' });
      await expect(service.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('returns new tokens for valid refresh', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      mockUsersService.findById.mockResolvedValueOnce({ ...mockUser, refreshToken: 'valid-refresh' });
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.refresh('valid-refresh');
      expect(result).toHaveProperty('accessToken');
    });
  });

  describe('verifyOtp', () => {
    it('throws UnauthorizedException when OTP not found', async () => {
      await expect(service.verifyOtp({ email: 'test@test.com', code: '123456' }))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('clears refresh token and returns message', async () => {
      mockUsersService.updateRefreshToken.mockResolvedValueOnce(undefined);
      const result = await service.logout('user-1');
      expect(result).toEqual({ message: 'Logged out' });
      expect(mockUsersService.updateRefreshToken).toHaveBeenCalledWith('user-1', null);
    });
  });
});
