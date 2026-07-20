import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  getWorkspaceRoles,
  rbacKeys,
  type WorkspaceAction,
} from '@/services/apis/rbac';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

interface WorkspaceAccessSummary {
  id: string;
  roleId?: string | null;
  roleKey?: string | null;
  accessSource?: 'membership' | 'platform_admin';
}

/** Exposes the selected workspace's server-defined relational capabilities. */
export function useWorkspacePermissions() {
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const workspace = workspaces.find(
    (candidate) => candidate.id === selectedWorkspace,
  ) as WorkspaceAccessSummary | undefined;
  const isPlatformAdmin = workspace?.accessSource === 'platform_admin';
  const isOwner = workspace?.roleKey === 'owner';
  const { data: roles = [], isLoading, isError } = useQuery({
    queryKey: rbacKeys.roles(selectedWorkspace),
    queryFn: () => getWorkspaceRoles(selectedWorkspace),
    enabled: Boolean(selectedWorkspace),
  });

  const can = useCallback(
    (action: WorkspaceAction) => {
      if (isPlatformAdmin || isOwner) return true;
      return (
        roles
          .find((role) => role.id === workspace?.roleId)
          ?.permissions.includes(action) ?? false
      );
    }, [isOwner, isPlatformAdmin, roles, workspace?.roleId],
  );

  return {
    role: workspace?.roleKey,
    can,
    isLoading,
    isError,
  };
}
