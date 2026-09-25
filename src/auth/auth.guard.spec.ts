import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import type { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';

const contextFor = (req: Partial<AuthenticatedRequest>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const guardWith = (implementation: (token: string) => AuthenticatedUser) => {
  const verifyBearer = vi
    .fn()
    .mockImplementation((token: string) => Promise.resolve(implementation(token)));
  const auth = { verifyBearer } as unknown as AuthService;
  return { guard: new JwtAuthGuard(auth), verifyBearer };
};

describe('JwtAuthGuard', () => {
  it('attaches the verified user and allows the request', async () => {
    const { guard, verifyBearer } = guardWith(() => ({
      id: 'user-1',
      email: 'ada@example.com',
    }));
    const req: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer token' } };

    const allowed = await guard.canActivate(contextFor(req));

    expect(allowed).toBe(true);
    expect(verifyBearer).toHaveBeenCalledWith('token');
    expect(req.authUser).toEqual({ id: 'user-1', email: 'ada@example.com' });
  });

  it('rejects a missing Authorization header with 401', async () => {
    const { guard, verifyBearer } = guardWith(() => ({ id: 'user-1' }));

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verifyBearer).not.toHaveBeenCalled();
  });

  it('rejects non-bearer schemes with 401', async () => {
    const { guard, verifyBearer } = guardWith(() => ({ id: 'user-1' }));
    const req: Partial<AuthenticatedRequest> = { headers: { authorization: 'Basic abc' } };

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(UnauthorizedException);
    expect(verifyBearer).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens with 401 and attaches nothing', async () => {
    const { guard } = guardWith(() => {
      throw new Error('bad');
    });
    const req: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer bad' } };

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(UnauthorizedException);
    expect(req.authUser).toBeUndefined();
  });
});
