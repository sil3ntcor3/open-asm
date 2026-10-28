import { describe, expect, it } from 'vitest';
import type {
  WorkspaceRoleDefinitionDtoRole,
  WorkspaceRoleDefinitionDtoPermissionsItem,
} from '@/services/apis/gen/queries';
import { workspaceRolePermissionsFixture } from '@/test/fixtures/workspace-role-permissions';
import * as workspaceRoles from '@/utils/workspace-roles';

describe('workspace role permissions', () => {
  it('derives UI actions from the server role catalog', () => {
    const hasWorkspacePermission = (
      workspaceRoles as typeof workspaceRoles & {
        hasWorkspacePermission?: (
          roles: typeof workspaceRolePermissionsFixture.roles,
          role: WorkspaceRoleDefinitionDtoRole | undefined,
          action: WorkspaceRoleDefinitionDtoPermissionsItem,
        ) => boolean;
      }
    ).hasWorkspacePermission;

    expect(hasWorkspacePermission).toBeDefined();
    if (!hasWorkspacePermission) return;

    expect(
      hasWorkspacePermission(
        workspaceRolePermissionsFixture.roles,
        'owner',
        'target.create',
      ),
    ).toBe(true);
    expect(
      hasWorkspacePermission(
        workspaceRolePermissionsFixture.roles,
        'owner',
        'scan.execute',
      ),
    ).toBe(true);
    expect(
      hasWorkspacePermission(
        workspaceRolePermissionsFixture.roles,
        'operator',
        'scan.execute',
      ),
    ).toBe(true);
  });

  it('separates global worker administration from workspace worker control', () => {
    const canManageWorkerScope = (
      workspaceRoles as typeof workspaceRoles & {
        canManageWorkerScope?: (
          scope: 'cloud' | 'workspace',
          isPlatformAdmin: boolean,
          canManageWorkspaceWorkers: boolean,
        ) => boolean;
      }
    ).canManageWorkerScope;

    expect(canManageWorkerScope).toBeDefined();
    if (!canManageWorkerScope) return;

    expect(canManageWorkerScope('cloud', true, false)).toBe(true);
    expect(canManageWorkerScope('cloud', false, true)).toBe(false);
    expect(canManageWorkerScope('workspace', true, false)).toBe(false);
    expect(canManageWorkerScope('workspace', false, true)).toBe(true);
  });
});
