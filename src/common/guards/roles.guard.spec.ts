import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const makeContext = (user: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => expect(guard).toBeDefined());

  it('allows access when no roles required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = makeContext({ id: '1', plan: 'free' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when user plan matches required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['pro', 'organization']);
    const ctx = makeContext({ id: '1', plan: 'pro' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when user role matches required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const ctx = makeContext({ id: '1', role: 'admin' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies access when user plan/role does not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['pro', 'organization']);
    const ctx = makeContext({ id: '1', plan: 'free' });
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies access when user is null', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['pro']);
    const ctx = makeContext(null);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
