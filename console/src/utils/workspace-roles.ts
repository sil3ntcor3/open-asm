import type {
  WorkspaceRoleDefinitionDto,
  WorkspaceRoleDefinitionDtoPermissionsItem,
  WorkspaceRoleDefinitionDtoRole,
} from '@/services/apis/gen/queries';

export const workspaceRoleOptions = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'operator', label: 'Operator' },
  { value: 'security_admin', label: 'Security Administrator' },
] as const;

export type AssignableWorkspaceRole =
  (typeof workspaceRoleOptions)[number]['value'];

export const workspaceRoleLabels: Record<string, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  operator: 'Operator',
  security_admin: 'Security Administrator',
  owner: 'Owner',
};

/** Resolves a UI capability from the role catalog returned by the API. */
export const hasWorkspacePermission = (
  roles: readonly WorkspaceRoleDefinitionDto[],
  role: WorkspaceRoleDefinitionDtoRole | string | undefined,
  action: WorkspaceRoleDefinitionDtoPermissionsItem,
): boolean =>
  roles
    .find((definition) => definition.role === role)
    ?.permissions.includes(action) ?? false;

/** Resolves worker settings access without crossing platform/workspace scope. */
export const canManageWorkerScope = (
  scope: 'cloud' | 'workspace',
  isPlatformAdmin: boolean,
  canManageWorkspaceWorkers: boolean,
): boolean => (scope === 'cloud' ? isPlatformAdmin : canManageWorkspaceWorkers);
