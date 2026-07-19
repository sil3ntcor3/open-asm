import { WORKSPACE_HEADER_NAME } from '@/common/constants/app.constants';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { WorkspaceAction } from './workspace-action.enum';
import { WorkspacePolicyGuard } from './workspace-policy.guard';
import type { WorkspacePolicyMetadata } from './workspace-policy.decorator';
import type { WorkspacePolicyService } from './workspace-policy.service';

describe('WorkspacePolicyGuard', () => {
  const userId = '0cc46e27-174e-46de-abd7-05858754c47f';
  const workspaceId = '3579afb6-d960-4fa6-8fdd-65bb72f77477';

  const createContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const createGuard = (policy: WorkspacePolicyMetadata) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(policy),
    } as unknown as Reflector;
    const policyService = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspacePolicyService;
    return {
      guard: new WorkspacePolicyGuard(reflector, policyService),
      policyService,
    };
  };

  it('authorizes the selected workspace through the central policy service', async () => {
    const { guard, policyService } = createGuard({
      action: WorkspaceAction.SCAN_EXECUTE,
    });
    const context = createContext({
      user: { id: userId },
      headers: { [WORKSPACE_HEADER_NAME]: workspaceId },
      cookies: {},
      params: {},
      body: {},
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(policyService.assertAllowed).toHaveBeenCalledWith(
      userId,
      workspaceId,
      WorkspaceAction.SCAN_EXECUTE,
    );
  });

  it('rejects a route workspace that differs from the selected workspace', async () => {
    const { guard, policyService } = createGuard({
      action: WorkspaceAction.TARGET_MANAGE,
      workspaceParam: 'workspaceId',
    });
    const context = createContext({
      user: { id: userId },
      headers: { [WORKSPACE_HEADER_NAME]: workspaceId },
      cookies: {},
      params: { workspaceId: '64d93ff8-a011-4473-ac3b-2fe5abe3f325' },
      body: {},
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Workspace context mismatch',
    );
    expect(policyService.assertAllowed).not.toHaveBeenCalled();
  });

  it('rejects a query workspace that differs from the selected workspace', async () => {
    const { guard, policyService } = createGuard({
      action: WorkspaceAction.WORKSPACE_READ,
      workspaceQuery: 'workspaceId',
    });
    const context = createContext({
      user: { id: userId },
      headers: { [WORKSPACE_HEADER_NAME]: workspaceId },
      cookies: {},
      params: {},
      query: { workspaceId: '64d93ff8-a011-4473-ac3b-2fe5abe3f325' },
      body: {},
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Workspace context mismatch',
    );
    expect(policyService.assertAllowed).not.toHaveBeenCalled();
  });

  it('rejects an invalid selected workspace before querying membership', async () => {
    const { guard, policyService } = createGuard({
      action: WorkspaceAction.WORKSPACE_READ,
    });
    const context = createContext({
      user: { id: userId },
      headers: { [WORKSPACE_HEADER_NAME]: 'not-a-workspace-id' },
      cookies: {},
      params: {},
      query: {},
      body: {},
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Workspace id null or invalid',
    );
    expect(policyService.assertAllowed).not.toHaveBeenCalled();
  });
});
