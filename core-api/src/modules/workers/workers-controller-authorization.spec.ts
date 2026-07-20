import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import type { WorkspacePolicyService } from '@/common/authorization/workspace-policy.service';
import { Role, WorkerScope } from '@/common/enums/enum';
import type { UserContextPayload } from '@/common/interfaces/app.interface';
import { ForbiddenException } from '@nestjs/common';
import type { AliveStreamManager } from './alive-stream-manager.service';
import type { ToolArtifactService } from './tool-artifact.service';
import { WorkersController } from './workers.controller';
import type { WorkersService } from './workers.service';

describe('WorkersController settings authorization', () => {
  const workspaceId = '93db9a95-c409-4db4-8ce4-10070eced20c';
  const workerId = '38e19467-4fd1-4fe9-8dde-6ae4ca19dfc0';
  const admin = { id: 'admin-id', role: Role.ADMIN } as UserContextPayload;
  const user = { id: 'user-id', role: Role.USER } as UserContextPayload;

  const createController = (scope: WorkerScope) => {
    const workersService = {
      getWorkerManagementScope: jest.fn().mockResolvedValue(scope),
      updateWorkerSettings: jest.fn().mockResolvedValue({ id: workerId }),
    } as unknown as WorkersService;
    const policyService = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspacePolicyService;
    const controller = Reflect.construct(WorkersController, [
      workersService,
      {} as AliveStreamManager,
      {} as ToolArtifactService,
      {},
      policyService,
    ]) as WorkersController;

    const update = (actor: UserContextPayload) =>
      Reflect.apply(controller.updateWorkerSettings, controller, [
        workerId,
        { isPaused: true },
        actor,
        workspaceId,
      ]) as Promise<unknown>;

    return { update, workersService, policyService };
  };

  it('allows platform administrators to control global workers', async () => {
    const { update, workersService, policyService } = createController(
      WorkerScope.CLOUD,
    );

    await expect(update(admin)).resolves.toEqual({ id: workerId });
    expect(policyService.assertAllowed).not.toHaveBeenCalled();
    expect(workersService.updateWorkerSettings).toHaveBeenCalledWith(
      workerId,
      { isPaused: true },
      workspaceId,
    );
  });

  it('denies non-admin platform users control of global workers', async () => {
    const { update, workersService } = createController(WorkerScope.CLOUD);

    await expect(update(user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(workersService.updateWorkerSettings).not.toHaveBeenCalled();
  });

  it('requires workspace worker management permission for workspace workers', async () => {
    const { update, policyService } = createController(WorkerScope.WORKSPACE);

    await update(user);

    expect(policyService.assertAllowed).toHaveBeenCalledWith(
      user.id,
      workspaceId,
      WorkspaceAction.WORKER_MANAGE,
    );
  });
});
