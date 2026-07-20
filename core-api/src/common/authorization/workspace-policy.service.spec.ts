import { WorkspaceRole } from '@/common/enums/enum';
import type { Repository } from 'typeorm';
import type { WorkspaceMembers } from '@/modules/workspaces/entities/workspace-members.entity';
import { WorkspaceAction } from './workspace-action.enum';
import { WorkspacePolicyService } from './workspace-policy.service';

describe('WorkspacePolicyService', () => {
  const workspaceId = '93db9a95-c409-4db4-8ce4-10070eced20c';
  const userId = '3ba38483-a2e5-4902-9adc-4cd9ad9c103c';

  const createService = (role?: WorkspaceRole) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(
        role
          ? {
              role,
              workspace: { id: workspaceId },
              user: { id: userId },
            }
          : null,
      ),
    } as unknown as Repository<WorkspaceMembers>;
    return { service: new WorkspacePolicyService(repository), repository };
  };

  it.each([
    [WorkspaceRole.VIEWER, WorkspaceAction.WORKSPACE_READ, true],
    [WorkspaceRole.VIEWER, WorkspaceAction.FINDING_TRIAGE, false],
    [WorkspaceRole.ANALYST, WorkspaceAction.TARGET_CREATE, true],
    [WorkspaceRole.ANALYST, WorkspaceAction.SCAN_EXECUTE, false],
    [WorkspaceRole.ANALYST, WorkspaceAction.REPORT_MANAGE, true],
    [WorkspaceRole.VIEWER, WorkspaceAction.REPORT_MANAGE, false],
    [WorkspaceRole.ANALYST, WorkspaceAction.AGENT_USE, true],
    [WorkspaceRole.VIEWER, WorkspaceAction.AGENT_USE, false],
    [WorkspaceRole.SECURITY_ADMIN, WorkspaceAction.AGENT_MANAGE, true],
    [WorkspaceRole.OPERATOR, WorkspaceAction.AGENT_MANAGE, false],
    [WorkspaceRole.OPERATOR, WorkspaceAction.SCAN_EXECUTE, true],
    [WorkspaceRole.VIEWER, WorkspaceAction.WORKER_READ, true],
    [WorkspaceRole.OWNER, WorkspaceAction.WORKER_READ, true],
    [WorkspaceRole.SECURITY_ADMIN, WorkspaceAction.WORKER_MANAGE, true],
    [WorkspaceRole.OWNER, WorkspaceAction.WORKER_MANAGE, false],
    [WorkspaceRole.SECURITY_ADMIN, WorkspaceAction.SECRET_MANAGE, true],
    [WorkspaceRole.OWNER, WorkspaceAction.SECRET_MANAGE, false],
    [WorkspaceRole.OWNER, WorkspaceAction.MEMBER_MANAGE, true],
    [WorkspaceRole.SECURITY_ADMIN, WorkspaceAction.MEMBER_MANAGE, false],
    [WorkspaceRole.OWNER, WorkspaceAction.WORKSPACE_MANAGE, true],
    [WorkspaceRole.OWNER, WorkspaceAction.TARGET_CREATE, true],
    [WorkspaceRole.OWNER, WorkspaceAction.TARGET_MANAGE, true],
    [WorkspaceRole.OWNER, WorkspaceAction.SCAN_EXECUTE, false],
  ])('enforces %s permission for %s', async (role, action, shouldAllow) => {
    const { service } = createService(role);

    const assertion = service.assertAllowed(userId, workspaceId, action);

    if (shouldAllow) {
      await expect(assertion).resolves.toBeUndefined();
    } else {
      await expect(assertion).rejects.toThrow('Workspace action denied');
    }
  });

  it('denies a user who is not a member of the selected workspace', async () => {
    const { service, repository } = createService();

    await expect(
      service.assertAllowed(
        userId,
        workspaceId,
        WorkspaceAction.WORKSPACE_READ,
      ),
    ).rejects.toThrow('Workspace action denied');
    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        workspace: { id: workspaceId },
        user: { id: userId },
      },
    });
  });

  it('publishes the same five-role permission catalog used for enforcement', () => {
    const { service } = createService();
    const catalogService = service as WorkspacePolicyService & {
      getRolePermissions?: () => Array<{
        role: WorkspaceRole;
        permissions: WorkspaceAction[];
      }>;
    };

    expect(catalogService.getRolePermissions).toBeDefined();
    if (!catalogService.getRolePermissions) return;

    const catalog = catalogService.getRolePermissions();
    expect(catalog.map(({ role }) => role)).toEqual([
      WorkspaceRole.VIEWER,
      WorkspaceRole.ANALYST,
      WorkspaceRole.OPERATOR,
      WorkspaceRole.SECURITY_ADMIN,
      WorkspaceRole.OWNER,
    ]);
    expect(
      catalog.find(({ role }) => role === WorkspaceRole.OWNER)?.permissions,
    ).toEqual(
      expect.arrayContaining([
        WorkspaceAction.TARGET_CREATE,
        WorkspaceAction.TARGET_MANAGE,
        WorkspaceAction.MEMBER_MANAGE,
      ]),
    );
    expect(
      catalog.find(({ role }) => role === WorkspaceRole.OWNER)?.permissions,
    ).not.toContain(WorkspaceAction.SCAN_EXECUTE);
    expect(
      catalog.find(({ role }) => role === WorkspaceRole.OWNER)?.permissions,
    ).not.toContain(WorkspaceAction.SECRET_MANAGE);
  });
});
