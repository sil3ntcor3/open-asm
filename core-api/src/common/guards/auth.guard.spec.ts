import { Role } from '@/common/enums/enum';
import type { RequestWithMetadata } from '@/common/interfaces/app.interface';
import { UsersController } from '@/modules/users/users.controller';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Auth } from 'better-auth/auth';
import { AuthGuard } from './auth.guard';

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (headers: unknown) => headers,
}));

describe('AuthGuard', () => {
  const createContext = (request: RequestWithMetadata) =>
    ({
      getClass: () => UsersController,
      getHandler: () => UsersController.prototype.setPlatformRole,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const createGuard = (role: Role) => {
    const auth = {
      options: {},
      api: {
        getSession: jest.fn().mockResolvedValue({
          session: { id: 'session-id', userId: 'user-id' },
          user: { id: 'user-id', role },
        }),
      },
    } as unknown as Auth;
    return new AuthGuard(new Reflector(), auth);
  };

  const createRequest = () =>
    ({
      headers: {},
      path: '/api/users/user-id/platform-role',
    }) as RequestWithMetadata;

  it('rejects ordinary users when the admin role is declared on the controller', async () => {
    const guard = createGuard(Role.USER);

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows administrators when the admin role is declared on the controller', async () => {
    const guard = createGuard(Role.ADMIN);

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).resolves.toBe(true);
  });
});
