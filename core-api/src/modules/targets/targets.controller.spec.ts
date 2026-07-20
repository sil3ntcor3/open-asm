import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import type { WorkspacePolicyService } from '@/common/authorization/workspace-policy.service';
import type { UserContextPayload } from '@/common/interfaces/app.interface';
import { Role } from '@/common/enums/enum';
import type { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';

describe('TargetsController', () => {
  const workspaceId = '93db9a95-c409-4db4-8ce4-10070eced20c';
  const userContext = {
    id: '3ba38483-a2e5-4902-9adc-4cd9ad9c103c',
    role: Role.USER,
  } as UserContextPayload;
  const result = {
    created: [],
    skipped: [],
    totalRequested: 1,
    totalCreated: 0,
    totalSkipped: 0,
  };

  const createController = () => {
    const targetsService = {
      createMultipleTargets: jest.fn().mockResolvedValue(result),
    } as unknown as TargetsService;
    const policyService = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspacePolicyService;
    const controller = Reflect.construct(TargetsController, [
      targetsService,
      policyService,
    ]);

    return { controller, targetsService, policyService };
  };

  it('requires scan permission when bulk creation also starts discovery', async () => {
    const { controller, policyService } = createController();

    await controller.createMultipleTargets(
      {
        targets: [{ value: 'example.com' }],
        startDiscovery: true,
      },
      userContext,
      workspaceId,
    );

    expect(policyService.assertAllowed).toHaveBeenCalledWith(
      { id: userContext.id, role: userContext.role },
      workspaceId,
      WorkspaceAction.SCAN_EXECUTE,
    );
  });

  it('does not require scan permission when a target is only registered', async () => {
    const { controller, policyService } = createController();

    await controller.createMultipleTargets(
      {
        targets: [{ value: 'example.com' }],
        startDiscovery: false,
      },
      userContext,
      workspaceId,
    );

    expect(policyService.assertAllowed).not.toHaveBeenCalled();
  });
});
