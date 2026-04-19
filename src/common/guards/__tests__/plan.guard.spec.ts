import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { PlanGuard } from '../plan.guard';

/**
 * Unit tests for PlanGuard. They intentionally avoid the Nest testing
 * harness — the guard is a pure function of (Reflector, Resolver) and
 * a minimal ExecutionContext stub is both faster and clearer.
 */
describe('PlanGuard', () => {
  const makeCtx = (userId: string | null = 'u1'): any => ({
    getHandler: () => () => undefined,
    switchToHttp: () => ({
      getRequest: () => (userId ? { user: { id: userId } } : {}),
    }),
  });

  it('allows when no capability is declared on the handler', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const effective = { resolve: jest.fn() } as any;

    const guard = new PlanGuard(reflector, effective);

    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
    expect(effective.resolve).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when user lacks canCreateOrg', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue('canCreateOrg'),
    } as unknown as Reflector;
    const effective = {
      resolve: jest.fn().mockResolvedValue({
        limits: { canCreateOrg: false, canInvite: false },
      }),
    } as any;

    const guard = new PlanGuard(reflector, effective);

    await expect(guard.canActivate(makeCtx())).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(makeCtx())).rejects.toThrow(
      /Organization plan/,
    );
  });

  it('allows when user has canCreateOrg', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue('canCreateOrg'),
    } as unknown as Reflector;
    const effective = {
      resolve: jest.fn().mockResolvedValue({
        limits: { canCreateOrg: true, canInvite: true },
      }),
    } as any;

    const guard = new PlanGuard(reflector, effective);

    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
    expect(effective.resolve).toHaveBeenCalledWith('u1');
  });
});
