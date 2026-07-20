import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  type WorkspaceRoleDefinitionDtoPermissionsItem,
  useWorkspacesControllerGetWorkspaceRolePermissions,
} from '@/services/apis/gen/queries';
import { hasWorkspacePermission } from '@/utils/workspace-roles';
import { useCallback } from 'react';

/** Exposes the selected workspace role and its server-defined capabilities. */
export function useWorkspacePermissions() {
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const role = workspaces.find(
    (workspace) => workspace.id === selectedWorkspace,
  )?.role;
  const { data, isLoading, isError } =
    useWorkspacesControllerGetWorkspaceRolePermissions();

  const can = useCallback(
    (action: WorkspaceRoleDefinitionDtoPermissionsItem) =>
      hasWorkspacePermission(data?.roles ?? [], role, action),
    [data?.roles, role],
  );

  return {
    role,
    can,
    isLoading,
    isError,
  };
}
