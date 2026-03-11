import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { WsJwtGuard } from './ws-jwt.guard';

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;

  const mockJwtService = {
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('jwt-secret'),
  };

  const makeContext = (client: any): ExecutionContext =>
    ({
      switchToWs: () => ({ getClient: () => client }),
    } as any);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsJwtGuard,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    guard = module.get<WsJwtGuard>(WsJwtGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(guard).toBeDefined());

  it('allows connection with valid token in auth', () => {
    const payload = { id: 'user-1', email: 'test@test.com' };
    mockJwtService.verify.mockReturnValue(payload);
    const client = { handshake: { auth: { token: 'valid-token' }, headers: {} } };
    const ctx = makeContext(client);
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(client).toHaveProperty('user', payload);
  });

  it('allows connection with valid token in authorization header', () => {
    const payload = { id: 'user-1' };
    mockJwtService.verify.mockReturnValue(payload);
    const client = { handshake: { auth: {}, headers: { authorization: 'Bearer valid-token' } } };
    const ctx = makeContext(client);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token', expect.any(Object));
  });

  it('throws when no token provided', () => {
    const client = { handshake: { auth: {}, headers: {} } };
    const ctx = makeContext(client);
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('throws when token is invalid', () => {
    mockJwtService.verify.mockImplementation(() => { throw new Error('invalid token'); });
    const client = { handshake: { auth: { token: 'bad-token' }, headers: {} } };
    const ctx = makeContext(client);
    expect(() => guard.canActivate(ctx)).toThrow();
  });
});
